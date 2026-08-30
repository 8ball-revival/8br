/**
 * Which of the two candidate databases does 8br.gg actually serve?
 *
 * Read-only. Finds a value that DIFFERS between them and can also be read off the live site, so the
 * answer is evidence rather than inference from a name.
 */
import { readFileSync } from 'node:fs'

const SP = 'C:/Users/Cerebro/AppData/Local/Temp/claude/C--Users-Cerebro/952b661e-7486-446a-90b1-a109d310f71e/scratchpad'
const CANDIDATES = ['eightballregistry_local_20260827', 'eightballregistry_launch_20260818_1458']

const { PrismaClient } = await import('@prisma/client')

for (const db of CANDIDATES) {
  const url = readFileSync(`${SP}/prod/cs_${db}.txt`, 'utf8').trim()
  const p = new PrismaClient({ datasources: { db: { url } } })
  try {
    console.log(`\n── ${db}`)

    const seasons = await p.$queryRawUnsafe<Record<string, unknown>[]>(
      `select s.id, s."number", s."competitionYear", s."lifecycleState", s."entrantsCount",
              (select count(*)::int from "public"."season_entrant" e where e."seasonId" = s.id) as entrants,
              s."updatedAt"::text as updated
         from "public"."season" s
        order by s."updatedAt" desc
        limit 4`)
    console.log('   most recently updated seasons:')
    for (const s of seasons) {
      console.log(`     id=${s.id} #${s.number} ${s.competitionYear} ${s.lifecycleState} entrants=${s.entrants} updated=${s.updated}`)
    }

    const players = await p.$queryRawUnsafe<Record<string, unknown>[]>(
      `select count(*)::int as n from "public"."Player"`)
    const recent = await p.$queryRawUnsafe<Record<string, unknown>[]>(
      `select "primaryName", "cueverseId", "createdAt"::text as created
         from "public"."Player" order by "createdAt" desc limit 3`)
    console.log(`   players: ${players[0].n}`)
    console.log('   newest players:')
    for (const r of recent) console.log(`     ${r.cueverseId ?? '-'} / ${r.primaryName}  created=${r.created}`)

    // The homepage rail reads the top of the CueVerse ladder.
    const top = await p.$queryRawUnsafe<Record<string, unknown>[]>(
      `select p."cueverseId", p."primaryName", l."ratingAfter"
         from "public"."rating_ledger" l
         join "public"."Player" p on p.id = l."playerId"
        where l.id in (select max(id) from "public"."rating_ledger" group by "playerId")
        order by l."ratingAfter" desc limit 5`)
    console.log('   top five by latest ledger rating:')
    for (const t of top) console.log(`     ${String(t.cueverseId ?? '-').padEnd(24)} ${t.primaryName} ${t.ratingAfter}`)
  } catch (e) {
    console.log('   error:', (e as Error).message.split(String.fromCharCode(10))[0].slice(0, 120))
  } finally {
    await p.$disconnect()
  }
}
