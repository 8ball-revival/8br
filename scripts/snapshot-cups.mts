/**
 * Generate the deterministic Cup snapshot from the DATABASE (source of truth).
 *
 *   npm run cups:snapshot
 *
 * Produces src/lib/cups/data/generated-cups.json — a derived compatibility artifact
 * consumed (via the shared cup data service) by the historical stat/ranking pipeline
 * and public Cup pages. No dev server required; no runtime filesystem writes.
 * Atomic: writes a temp file, validates + compares against the adapter output, and
 * only then replaces the previous snapshot. Fails (keeping the old snapshot) on any
 * validation/comparison error. Deterministic: contains no timestamps or generated IDs.
 */
import { PrismaClient } from '@prisma/client'
import { mkdirSync, writeFileSync, renameSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cupsFromCompRows, type CompRow } from '../src/lib/cups/adapter.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../src/lib/cups/data/generated-cups.json')
const TMP = OUT + '.tmp'
const SCHEMA_VERSION = 1

const prisma = new PrismaClient()

function fail(msg: string): never {
  console.error(`✗ Snapshot NOT written — ${msg}`)
  if (existsSync(TMP)) rmSync(TMP)
  process.exit(1)
}

try {
  const comps = await prisma.tournament.findMany({
    where: { competitionType: 'CUP' },
    orderBy: { number: 'asc' },
    include: { cupBracketMatches: true, cupTeamTies: { include: { matches: true } } },
  })
  if (comps.length === 0) fail('no cups found in the database (run the cup import first)')

  const cups = cupsFromCompRows(comps as unknown as CompRow[])

  // Validate structure (never allow private/account fields; require the core fields).
  const BANNED = ['email', 'userId', 'password', 'discord', 'token', 'session']
  for (const c of cups) {
    if (typeof c.number !== 'number') fail(`cup missing number: ${JSON.stringify(c).slice(0, 80)}`)
    if (!c.name || !c.format || !c.status) fail(`cup #${c.number} missing name/format/status`)
    const blob = JSON.stringify(c).toLowerCase()
    for (const b of BANNED) if (blob.includes(`"${b}"`)) fail(`cup #${c.number} contains banned field "${b}"`)
  }

  const snapshot = { schemaVersion: SCHEMA_VERSION, source: 'database', cupCount: cups.length, cups }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(TMP, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')

  // Compare the written file (round-tripped through JSON) against the adapter output.
  const written = JSON.parse(readFileSync(TMP, 'utf8'))
  if (JSON.stringify(written.cups) !== JSON.stringify(cups)) fail('written snapshot does not match adapter output (JSON round-trip lossy)')
  if (written.cupCount !== cups.length) fail('cupCount mismatch')

  renameSync(TMP, OUT) // atomic replace

  // Also update the DB-backed versioned snapshot (the live derived-data revision).
  const prev = await prisma.tournamentSnapshot.findUnique({ where: { id: 1 } })
  const revision = (prev?.revision ?? 0) + 1
  await prisma.tournamentSnapshot.upsert({
    where: { id: 1 },
    update: { revision, payload: cups as unknown as object },
    create: { id: 1, revision, payload: cups as unknown as object },
  })

  console.log(`✓ Snapshot written: ${cups.length} cups → src/lib/cups/data/generated-cups.json (DB revision ${revision})`)
  console.log(`  cup numbers: ${cups.map((c) => c.number).join(', ')}`)
  const teamCups = cups.filter((c) => c.teamTies).length
  const deCups = cups.filter((c) => c.winnersBracket).length
  console.log(`  team-tie cups: ${teamCups} · double-elim cups: ${deCups} · schemaVersion ${SCHEMA_VERSION}`)
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
} finally {
  await prisma.$disconnect()
}
