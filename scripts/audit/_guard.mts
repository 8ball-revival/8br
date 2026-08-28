/**
 * The gate on every production audit.
 *
 * ── Why audits are separate from verification ───────────────────────────────────────────────────
 * The development suite proves the APPLICATION behaves: it runs against invented fixtures, writes
 * freely, and is meant to be run constantly. An audit proves the RECORD is intact — that the 2005
 * season still has its champion, that the tribute article still has its body — and only production
 * holds data those questions can be asked of.
 *
 * Mixing them was the mistake this separates. A suite that asserted both could not run without real
 * data, which is how "verify the app works" ended up requiring a copy of production on every
 * developer's machine.
 *
 * ── What this refuses ───────────────────────────────────────────────────────────────────────────
 * Everything, by default. An audit runs only when a person supplies a production connection for that
 * one invocation and passes --confirm, and the session it opens is READ ONLY at the PostgreSQL level
 * — not by convention, and not by the audit remembering to only write SELECTs. A write is refused by
 * the database.
 *
 * The connection is never read from DATABASE_URL and never stored: not in `.env`, not in
 * `.env.example`, not in the repository. It lives in the operator's shell for the length of one
 * command.
 *
 * Usage:
 *   PRODUCTION_AUDIT_URL="postgresql://..." npm run audit:production -- --confirm
 */
import type { PrismaClient } from '@prisma/client'

export interface AuditContext {
  db: PrismaClient
  check: (label: string, ok: boolean, detail?: string) => void
  section: (title: string) => void
  failures: () => number
}

/**
 * Open a read-only connection to production, or refuse.
 *
 * Returns a Prisma client constructed directly against the supplied URL rather than the application
 * singleton — the singleton refuses production from a local process, which is correct for the app
 * and exactly wrong for the one tool whose job is to read it.
 */
export async function openAudit(): Promise<AuditContext> {
  const url = process.env.PRODUCTION_AUDIT_URL

  if (!process.argv.includes('--confirm')) {
    console.error('✗ Refusing to run.')
    console.error('  A production audit reads the live database. It runs only when asked twice:')
    console.error('    PRODUCTION_AUDIT_URL="postgresql://..." npm run audit:production -- --confirm')
    process.exit(1)
  }

  if (!url) {
    console.error('✗ PRODUCTION_AUDIT_URL is not set.')
    console.error('  Deliberately not DATABASE_URL: the variable development uses must never be the')
    console.error('  one pointing at production. Supply it for this command and nowhere else.')
    process.exit(1)
  }

  /*
   * A fixture database cannot answer these questions, and pointing an audit at one would produce a
   * page of failures that mean nothing. Refused for clarity rather than safety.
   */
  const database = url.split('/').pop()?.split('?')[0] ?? ''
  if (/(localhost|127\.0\.0\.1)/.test(url) || database.includes('fixtures') || database.includes('staging')) {
    console.error(`✗ "${database}" is not production.`)
    console.error('  These assertions are about the real competition record. Nothing else can satisfy them.')
    process.exit(1)
  }

  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient({ datasources: { db: { url } }, log: ['error'] })

  /*
   * Read-only enforced BY POSTGRES, for the whole session. An audit that merely intends to read is
   * one typo away from writing; this makes the write impossible rather than unlikely.
   */
  await db.$executeRawUnsafe('set session characteristics as transaction read only')

  let failures = 0
  const check = (label: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
    if (!ok) failures++
  }
  const section = (title: string) => console.log(`\n--- ${title} ---`)

  const shown = url.replace(/:\/\/[^@]*@/, '://***@')
  console.log(`Auditing ${shown}`)
  console.log('Session is READ ONLY; the database will refuse any write.\n')

  return { db, check, section, failures: () => failures }
}

/** Prove the read-only session is real, rather than trusting the SET succeeded. */
export async function assertReadOnly(ctx: AuditContext): Promise<void> {
  ctx.section('The session cannot write')
  let refused = false
  try {
    await ctx.db.$executeRawUnsafe(`create table if not exists _audit_write_probe (id int)`)
  } catch {
    refused = true
  }
  ctx.check('a write is refused by the database itself', refused)
}
