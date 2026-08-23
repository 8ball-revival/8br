/**
 * Separate neo from Craig, who a lookalike handle had merged into one identity.
 *
 * ── The two handles ──────────────────────────────────────────────────────────────────────────────
 * They differ by one character:
 *
 *   I_Am_Almost_God   an L, "almost"   — neo. Used once, in an early Season, and never again.
 *   I_Am_AImost_God   a capital i      — Craig, who copied it later.
 *
 * Normalisation keeps them apart (`iamalmostgod` against `iamaimostgod`), so the two were never in
 * conflict. What went wrong was which account held which: the Player carrying neo's spelling as its
 * CueVerse ID had Craig's `cockyguy` hung off it as an alias, so one record stood for two people.
 *
 * ── What this does ───────────────────────────────────────────────────────────────────────────────
 * Takes Craig's handle off that Player, then folds the Player into Starkiller — the account that
 * already holds neo's other handles — because its one appearance, 2010 S1A, is printed there as
 * `i_am_almost_god` and is therefore neo's, along with the rating-ledger rows that came from it.
 *
 * Craig is not created here. He has no imported appearance yet; the first is 2012 S3A, which will
 * create him from `Cocky_Guy` when it imports, and `I_am_AImost_God` is recorded against him then.
 *
 * Usage: tsx scripts/archive-correct-neo-craig.mts [--apply]
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { removeAlias } from '../src/lib/players/aliases.ts'
import { mergeAccounts } from '../src/lib/players/merge.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')
const ACTOR = { userId: 2, username: 'archive-import' }

const NEO = 'cmsys8lj000016rigqrgtm4qb' // Starkiller
const STRAY = 'cmt4vb43900if6rikxk1o9ing' // the Player whose CueVerse ID is i_am_almost_god

const starkiller = await prisma.player.findUnique({ where: { id: NEO }, select: { id: true, cueverseId: true } })
const stray = await prisma.player.findUnique({
  where: { id: STRAY },
  select: { id: true, cueverseId: true, aliases: { select: { id: true, alias: true } } },
})

if (!starkiller) { console.log(`NO-OP: ${NEO} no longer exists`); process.exit(0) }
if (!stray) { console.log('ALREADY DONE: the stray Player no longer exists — it has been merged'); process.exit(0) }

const entrants = await prisma.seasonEntrant.findMany({
  where: { playerId: STRAY },
  select: { cueverseId: true, season: { select: { competitionYear: true, number: true, division: true } } },
})
const ledger = await prisma.ratingLedger.count({ where: { playerId: STRAY } })

console.log(`stray:      ${stray.cueverseId} (${STRAY})`)
console.log(`  aliases:  ${stray.aliases.map((a) => a.alias).join(', ') || '—'}`)
console.log(`  entrants: ${entrants.map((e) => `${e.season.competitionYear} S${e.season.number}${e.season.division ?? ''} as "${e.cueverseId}"`).join('; ') || '—'}`)
console.log(`  ledger:   ${ledger} row(s)`)
console.log(`into:       ${starkiller.cueverseId} (${NEO})`)

/*
 * Refuse if the stray turns out to hold an appearance printed with Craig's spelling.
 *
 * The whole basis for folding this record into neo is that everything on it was printed "almost".
 * One entrant printed "aimost" would mean the record really does carry both people, and merging it
 * would move Craig's match onto neo rather than separating them.
 */
const craigSpelled = entrants.filter((e) => /aimost/i.test(e.cueverseId ?? ''))
if (craigSpelled.length > 0) {
  console.log(`\nREFUSED: ${craigSpelled.length} appearance(s) printed with Craig's spelling — this record holds both people`)
  await prisma.$disconnect()
  process.exit(1)
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing changed. Re-run with --apply.')
  await prisma.$disconnect()
  process.exit(0)
}

for (const a of stray.aliases.filter((x) => /^cockyguy$/i.test(x.alias))) {
  const r = await removeAlias(ACTOR, STRAY, a.id)
  console.log(`  ${r.ok ? 'removed' : `FAILED to remove`} alias "${a.alias}"${r.ok ? '' : `: ${r.error}`}`)
}

const merged = await mergeAccounts(
  ACTOR,
  NEO,
  STRAY,
  'archive reconstruction: I_Am_Almost_God is neo, not Craig — Craig used the lookalike I_Am_AImost_God',
)
console.log(merged.ok ? `  merged into ${starkiller.cueverseId}` : `  MERGE FAILED: ${merged.error}`)

if (merged.ok) {
  const after = await prisma.seasonEntrant.count({ where: { playerId: NEO } })
  const aliases = await prisma.playerAlias.findMany({ where: { playerId: NEO }, select: { alias: true } })
  console.log(`  ${starkiller.cueverseId} now has ${after} entrant(s)`)
  console.log(`  cockyguy still on it: ${aliases.some((a) => /^cockyguy$/i.test(a.alias)) ? 'YES — investigate' : 'no'}`)
}

await prisma.$disconnect()
