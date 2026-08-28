// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import './_retired.mjs'

/**
 * Migrate the eighteen hard-coded achievements into editable definitions.
 *
 * ── Automatic where the rule is provable, Manual where it is not ─────────────────────────────────
 * Ten of the eighteen map cleanly onto a statistic the rule builder supports, and those become
 * AUTOMATIC — the engine reproduces them and they will follow the data from now on.
 *
 * The other eight do not. "Get a room" is about a PAIR of players, "Took the scenic route" measures
 * a gap between two titles, "Group-stage merchant" is a difference between two rates. The rule
 * builder deliberately does not model any of those, and inventing an approximation would publish a
 * different fact under the same name. They are seeded as MANUAL, carrying the value the old engine
 * computed, so nothing disappears and nothing is silently reinterpreted.
 *
 * ── Idempotent ───────────────────────────────────────────────────────────────────────────────────
 * Keyed by `key` and upserted, so running it twice changes nothing and re-running after a code
 * change refreshes the seeded set without touching anything an administrator has since edited by
 * hand — those have different keys.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/seed-achievements.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { loadAchievementFacts } from '../src/lib/achievements/facts.ts'
import { computeAchievements } from '../src/lib/achievements/compute.ts'
import { getLadder } from '../src/lib/stats/ladder.ts'

assertLocalDatabase('seed-achievements')

type Auto = {
  key: string; title: string; flavor: string; description: string
  statistic: string; winner?: 'HIGHEST' | 'LOWEST'; format: string
  scope?: 'ALL_COMPETITIONS' | 'SEASONS' | 'TOURNAMENTS'
  minMatches?: number; minFinals?: number
}

/** The ten that the rule builder can express exactly. */
const AUTOMATIC: Auto[] = [
  { key: 'the-choker', title: 'THE CHOKER', flavor: 'Got all the way there. Repeatedly.',
    description: 'Reached the Final and lost it.', statistic: 'finalsLost', format: '{value} FINALS LOST',
    scope: 'SEASONS' },
  { key: 'we-get-it', title: "WE GET IT, YOU'RE GOOD", flavor: 'Leave some for the rest of them.',
    description: 'Most Season Championships in the archive.', statistic: 'seasonTitles',
    format: '{value} CHAMPIONSHIPS', scope: 'SEASONS' },
  { key: 'find-another-hobby', title: 'PLEASE FIND ANOTHER HOBBY', flavor: 'Signed up for everything. Every single time.',
    description: 'Entered more Seasons than anybody.', statistic: 'seasonsPlayed', format: '{value} SEASONS',
    scope: 'SEASONS' },
  { key: 'most-losses', title: 'MOST LOSSES OF ALL TIME', flavor: 'Kept turning up anyway.',
    description: 'More recorded losses than anybody in the archive.', statistic: 'losses',
    format: '{value} LOSSES' },
  { key: 'most-wins', title: 'ABSOLUTE UNIT', flavor: 'Just kept winning.',
    description: 'More recorded wins than anybody in the archive.', statistic: 'wins',
    format: '{value} WINS' },
  { key: 'best-win-rate', title: 'BEST WIN PERCENTAGE', flavor: 'Hard to argue with.',
    description: 'The best win rate over a real number of matches.', statistic: 'winPct',
    format: '{value}% WIN RATE', minMatches: 50 },
  { key: 'finals-machine', title: 'ALWAYS IN THE FINAL', flavor: 'Reliable to the very last match.',
    description: 'Reached more Season Finals than anybody.', statistic: 'finalsReached',
    format: '{value} FINALS', scope: 'SEASONS' },
  { key: 'group-stage-wins', title: 'GROUP STAGE SPECIALIST', flavor: 'Unbeatable in the early rounds.',
    description: 'Most Season group-stage wins.', statistic: 'groupWins', format: '{value} GROUP WINS',
    scope: 'SEASONS' },
  { key: 'playoff-losses', title: 'ONE ROUND TOO FAR', flavor: 'Made the bracket. Left the bracket.',
    description: 'Most Season playoff losses.', statistic: 'playoffLosses', format: '{value} PLAYOFF LOSSES',
    scope: 'SEASONS' },
  { key: 'longest-streak', title: 'UNSTOPPABLE', flavor: 'Nobody could end it.',
    description: 'The longest unbroken run of wins in the archive.', statistic: 'longestWinStreak',
    format: '{value} IN A ROW' },
]

/**
 * The eight that stay manual, and the id of the old computed award each one carries over.
 *
 * Each names the reason the rule builder cannot express it, so nobody later mistakes them for
 * something that was simply not converted yet.
 */
const MANUAL: { key: string; from: string; why: string }[] = [
  { key: 'small-sample-size-king', from: 'small-sample-size-king',
    why: 'Undefeated-with-a-minimum is a compound condition on two statistics at once.' },
  { key: 'scenic-route', from: 'scenic-route',
    why: 'Measures the gap in seasons BETWEEN two titles, which is a sequence question, not a total.' },
  { key: 'most-violent-final', from: 'most-violent-final',
    why: 'A property of one MATCH (its winning margin), not an aggregate over a player.' },
  { key: 'refused-to-lose', from: 'refused-to-lose',
    why: 'Requires a whole season with zero losses, draws and walkovers — a per-season condition.' },
  { key: 'get-a-room', from: 'get-a-room',
    why: 'The subject is a PAIR of players; the rule builder ranks individuals.' },
  { key: 'always-invited', from: 'always-invited',
    why: 'A ratio of two statistics (playoff appearances per title).' },
  { key: 'group-stage-merchant', from: 'group-stage-merchant',
    why: 'The DIFFERENCE between two win rates at different stages.' },
  { key: 'nobody-completed-assignment', from: 'nobody-completed-assignment',
    why: 'A site-wide fact about consecutive titles, with no single holder.' },
]

async function main() {
  const facts = await loadAchievementFacts('YAHOO')
  const ladder = await getLadder('all-time', new Date(), 'YAHOO')
  const ratings = new Map(ladder.map((r) => [r.playerId, r.rating]))
  const legacy = computeAchievements(facts, ratings)
  const byId = new Map(legacy.map((a) => [a.id, a]))

  let order = 0
  let created = 0
  let updated = 0

  for (const a of AUTOMATIC) {
    order += 10
    const data = {
      title: a.title,
      flavorText: a.flavor,
      description: a.description,
      awardType: 'AUTOMATIC' as const,
      status: 'ACTIVE' as const,
      sortOrder: order,
      displayFormat: a.format,
      statistic: a.statistic,
      scope: (a.scope ?? 'ALL_COMPETITIONS') as never,
      stage: 'ALL_MATCHES' as never,
      winner: (a.winner ?? 'HIGHEST') as never,
      platform: 'YAHOO' as const,
      minMatches: a.minMatches ?? null,
      minFinals: a.minFinals ?? null,
      tiePolicy: 'SHOW_ALL' as never,
      emptyBehavior: 'HIDE' as never,
      createdBy: 'seed',
      updatedBy: 'seed',
    }
    const existing = await prisma.achievementDefinition.findUnique({ where: { key: a.key } })
    if (existing) { await prisma.achievementDefinition.update({ where: { key: a.key }, data }); updated++ }
    else { await prisma.achievementDefinition.create({ data: { ...data, key: a.key } }); created++ }
  }

  for (const m of MANUAL) {
    order += 10
    const old = byId.get(m.from)
    if (!old) { console.log(`  (skipped ${m.key}: the old engine produced nothing for it)`); continue }
    const holder = old.winners[0] ?? null
    const player = holder
      ? await prisma.player.findFirst({ where: { id: holder.playerId }, select: { id: true } })
      : null

    const data = {
      title: old.title,
      flavorText: old.caption,
      description: old.detail,
      awardType: 'MANUAL' as const,
      status: 'ACTIVE' as const,
      sortOrder: order,
      displayFormat: '{value}',
      manualPlayerId: player?.id ?? null,
      manualValue: old.stat || '—',
      manualNote: `Carried over from the original engine. ${m.why}`,
      platform: 'YAHOO' as const,
      createdBy: 'seed',
      updatedBy: 'seed',
    }
    const existing = await prisma.achievementDefinition.findUnique({ where: { key: m.key } })
    if (existing) { await prisma.achievementDefinition.update({ where: { key: m.key }, data }); updated++ }
    else { await prisma.achievementDefinition.create({ data: { ...data, key: m.key } }); created++ }
  }

  const total = await prisma.achievementDefinition.count()
  console.log(`\nSeeded: ${created} created, ${updated} updated. ${total} definitions in total.`)
  console.log(`  ${AUTOMATIC.length} automatic (the rule engine reproduces these and they follow the data)`)
  console.log(`  ${MANUAL.length} manual (preserved verbatim; the rule builder cannot express them)`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
