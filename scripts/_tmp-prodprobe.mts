/**
 * Read-only identity probe for the candidate production databases.
 *
 * Connects, counts, and disconnects. Every statement below is a SELECT; nothing here writes, and the
 * connection string is read from a file and never printed.
 */
import { readFileSync } from 'node:fs'

const SP = 'C:/Users/Cerebro/AppData/Local/Temp/claude/C--Users-Cerebro/952b661e-7486-446a-90b1-a109d310f71e/scratchpad'
const DBS = [
  'eightballregistry_local_20260827',
  'eightballregistry_prod_20260827',
  'eightballregistry_launch_20260818_1458',
  'neondb',
]

const { PrismaClient } = await import('@prisma/client')

const one = async (db: string) => {
  const url = readFileSync(`${SP}/prod/cs_${db}.txt`, 'utf8').trim()
  if (!url.startsWith('postgres')) return { db, error: 'no connection string' }
  const p = new PrismaClient({ datasources: { db: { url } } })
  try {
    const q = async (sql: string) => {
      const r = await p.$queryRawUnsafe<Record<string, unknown>[]>(sql)
      return r[0] ? Object.values(r[0])[0] : null
    }
    const tables = await q(`select count(*)::int from information_schema.tables where table_schema='public'`)
    if (Number(tables) === 0) return { db, tables: 0, note: 'empty public schema' }

    const has = async (t: string) => Number(await q(
      `select count(*)::int from information_schema.tables where table_schema='public' and table_name='${t}'`)) > 0

    const out: Record<string, unknown> = { db, tables: Number(tables) }
    out.seasons = (await has('season')) ? Number(await q(`select count(*)::int from "public"."season"`)) : 'n/a'
    out.ledger = (await has('rating_ledger')) ? Number(await q(`select count(*)::int from "public"."rating_ledger"`)) : 'n/a'
    out.entrants = (await has('season_entrant')) ? Number(await q(`select count(*)::int from "public"."season_entrant"`)) : 'n/a'
    out.matches = (await has('season_match')) ? Number(await q(`select count(*)::int from "public"."season_match"`)) : 'n/a'
    out.tournaments = (await has('comp_tournament')) ? Number(await q(`select count(*)::int from "public"."comp_tournament"`)) : 'n/a'
    out.players = (await has('Player')) ? Number(await q(`select count(*)::int from "public"."Player"`)) : 'n/a'
    out.articles = (await has('article')) ? Number(await q(`select count(*)::int from "public"."article"`)) : 'n/a'
    out.migrations = (await has('_prisma_migrations')) ? Number(await q(`select count(*)::int from "public"."_prisma_migrations"`)) : 'n/a'
    out.sitePages = (await has('site_page')) ? Number(await q(`select count(*)::int from "public"."site_page"`)) : 'absent'
    out.latestSeason = (await has('season'))
      ? String(await q(`select coalesce(max("updatedAt")::text,'-') from "public"."season"`)) : 'n/a'
    out.latestArticle = (await has('article'))
      ? String(await q(`select coalesce(max("publishAt")::text,'-') from "public"."article"`)) : 'n/a'

    if (await has('season')) {
      const s = await p.$queryRawUnsafe<Record<string, unknown>[]>(
        `select id, "number", "lifecycleState", "championName", "championHandle", "runnerUpName", "finalScore"
           from "public"."season" where id = 16426`)
      out.season16426 = s[0] ? JSON.stringify(s[0]) : 'absent'
    }
    return out
  } catch (e) {
    return { db, error: (e as Error).message.split(String.fromCharCode(10))[0].slice(0, 110) }
  } finally {
    await p.$disconnect()
  }
}

for (const db of DBS) {
  const r = await one(db)
  console.log(`\n── ${db}`)
  for (const [k, v] of Object.entries(r)) {
    if (k === 'db') continue
    console.log(`     ${k.padEnd(14)} ${v}`)
  }
}
