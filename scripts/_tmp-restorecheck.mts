/**
 * Prove the production backup actually restored, by comparing the restored copy with production.
 *
 * Both sides read-only. A dump that runs without error is not evidence: pg_restore exits zero on a
 * dump that skipped rows it could not place, so the check is that the two databases AGREE.
 */
import { readFileSync } from 'node:fs'

const SP = 'C:/Users/Cerebro/AppData/Local/Temp/claude/C--Users-Cerebro/952b661e-7486-446a-90b1-a109d310f71e/scratchpad'
const PROD = readFileSync(`${SP}/prod/cs_eightballregistry_local_20260827.txt`, 'utf8').trim()
const COPY = 'postgresql://postgres:SXvLdGPAGev9eRjQHlPtHrQKlN3eDSrwZyog05nYI@127.0.0.1:55432/8br_test_restoreverify'

const TABLES = [
  'season', 'season_entrant', 'season_group', 'season_match', 'season_standing',
  'season_playoff_match', 'comp_tournament', 'comp_registration', 'comp_playoff_match',
  'Player', 'PlayerAlias', 'PlayerMerge', 'rating_ledger', 'article', 'break_post',
  'comp_audit_log', '_prisma_migrations',
]

const { PrismaClient } = await import('@prisma/client')
const prod = new PrismaClient({ datasources: { db: { url: PROD } } })
const copy = new PrismaClient({ datasources: { db: { url: COPY } } })

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

try {
  const count = async (c: InstanceType<typeof PrismaClient>, sql: string) => {
    const r = await c.$queryRawUnsafe<Record<string, unknown>[]>(sql)
    return Number(Object.values(r[0])[0])
  }

  const prodTables = await count(prod, `select count(*)::int from information_schema.tables where table_schema='public'`)
  const copyTables = await count(copy, `select count(*)::int from information_schema.tables where table_schema='public'`)
  check('the restored copy has the same table count', prodTables === copyTables, `${copyTables} vs ${prodTables}`)

  for (const t of TABLES) {
    const a = await count(prod, `select count(*)::int from "public"."${t}"`)
    const b = await count(copy, `select count(*)::int from "public"."${t}"`)
    check(`${t}`, a === b, `${b} rows, production has ${a}`)
  }

  // The row the whole archive is judged by.
  const q = `select id, "number", "lifecycleState", "championName", "championHandle", "runnerUpName", "finalScore"
               from "public"."season" where id = 16426`
  const a = JSON.stringify((await prod.$queryRawUnsafe(q))[0] ?? null)
  const b = JSON.stringify((await copy.$queryRawUnsafe(q))[0] ?? null)
  check('Season 16426 survives the round trip', a === b && a.includes('COMPLETED'), b)

  // And the season that proved which database this is.
  const q2 = `select id, "lifecycleState" from "public"."season" where id = 16427`
  const a2 = JSON.stringify((await prod.$queryRawUnsafe(q2))[0] ?? null)
  const b2 = JSON.stringify((await copy.$queryRawUnsafe(q2))[0] ?? null)
  check('Season 16427 keeps its in-progress state', a2 === b2, b2)

  const recentPlayers = `select count(*)::int from "public"."Player" where "createdAt" > now() - interval '3 days'`
  const pa = await count(prod, recentPlayers)
  const pb = await count(copy, recentPlayers)
  check('recent player registrations are in the backup', pa === pb && pa > 0, `${pb} in the last three days`)

  const payload = await count(copy, `select count(*)::int from information_schema.tables where table_schema='payload'`)
  check('the payload schema came across too', payload > 0, `${payload} tables`)
} finally {
  await prod.$disconnect()
  await copy.$disconnect()
}

console.log(`\n${pass} checks passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
