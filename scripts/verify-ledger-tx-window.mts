/**
 * Every transaction that rebuilds the rating ledger gets a window big enough to hold it.
 *
 * Closing a Tournament failed on production with Prisma P2028:
 *
 *   Transaction already closed ... timeout was 5000 ms, however 5049 ms passed
 *
 * `rebuildRatingLedger` wipes the ledger and replays every eligible season and tournament — 16,000-odd
 * rows across fifty-odd competitions, ~2.5s locally and just over 5s against Neon from a lambda. It
 * ran inside `prisma.$transaction(...)` with no options, so Prisma's five-second default applied.
 * Being 50ms over the line is why the same close failed once and succeeded on a retry.
 *
 * Eight call sites rebuild the ledger and exactly ONE had remembered to raise the timeout, so this
 * checks the property across all of them rather than the one that broke.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/verify-ledger-tx-window.mts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { LEDGER_TX_OPTIONS } from '../src/lib/stats/ledger.ts'

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** The text of each `prisma.$transaction( ... )` call in a file, balanced on parentheses. */
function transactions(src: string): string[] {
  const out: string[] = []
  let from = 0
  for (;;) {
    const at = src.indexOf('prisma.$transaction(', from)
    if (at === -1) break
    let i = src.indexOf('(', at)
    let depth = 0
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1
      else if (src[i] === ')') { depth -= 1; if (depth === 0) break }
    }
    out.push(src.slice(at, i + 1))
    from = i + 1
  }
  return out
}

section('The window is stated once, and it is generous')
{
  check('the shared options exist', typeof LEDGER_TX_OPTIONS.timeout === 'number')
  /*
   * Comfortably above the ~5s the replay costs today, because the cost grows with the archive and
   * the failure mode is a half-finished close rather than a slow one.
   */
  check('the timeout is far above the observed cost',
    LEDGER_TX_OPTIONS.timeout >= 60_000, `${LEDGER_TX_OPTIONS.timeout}ms`)
  check('...and it waits for a connection rather than failing fast',
    (LEDGER_TX_OPTIONS.maxWait ?? 0) >= 10_000, `${LEDGER_TX_OPTIONS.maxWait}ms`)
}

section('No ledger rebuild runs on the default five-second timeout')
{
  const files = walk('src').filter((f) => !f.endsWith('stats/ledger.ts'))
  const offenders: string[] = []
  let guarded = 0

  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (!src.includes('rebuildRatingLedger')) continue
    for (const tx of transactions(src)) {
      if (!tx.includes('rebuildRatingLedger')) continue
      if (tx.includes('LEDGER_TX_OPTIONS') || /timeout:\s*\d/.test(tx)) { guarded += 1; continue }
      offenders.push(f)
    }
  }

  check('every ledger transaction carries an explicit window',
    offenders.length === 0, offenders.join(', '))
  check('...and there are several of them, so this is not vacuous',
    guarded >= 6, `${guarded} guarded`)

  /*
   * `transitionSeasonState` hands its work to a callback, so the rebuild is not lexically inside the
   * `$transaction(...)` call and the scan above cannot see it. Checked by name instead.
   */
  const seasons = readFileSync('src/lib/seasons/lifecycle.ts', 'utf8')
  check('the Season reopen path is covered too',
    /prisma\.\$transaction\(run, LEDGER_TX_OPTIONS\)/.test(seasons))
}

section('The function outlives the transaction it starts')
{
  const pages = [
    'src/app/(frontend)/creator/tournaments/[id]/[stage]/page.tsx',
    'src/app/(frontend)/creator/seasons/[id]/playoffs/page.tsx',
  ]
  for (const p of pages) {
    const src = readFileSync(p, 'utf8')
    const m = src.match(/export const maxDuration = (\d+)/)
    check(`${p.split('/').slice(-3).join('/')} allows a long close`,
      !!m && Number(m[1]) >= 60, m?.[1] ?? 'unset')
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
