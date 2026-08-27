/**
 * What the archive itself cannot tell us, season by season — and how hard that limit is.
 *
 * ── The distinction this exists to draw ─────────────────────────────────────────────────────────
 * A Season can fail its audit for two completely different reasons. Either the database contradicts
 * evidence that exists, which is a defect and must be fixed; or the evidence does not exist, which
 * is a limit of the capture and cannot be fixed by any amount of reconstruction. Treating the second
 * as the first produces a suite that can never pass and a repair that invents data to satisfy it.
 *
 * ── The placeholders ────────────────────────────────────────────────────────────────────────────
 * Four Seasons print the literal `tbd` in round-one positions. For each one this asks whether the
 * bracket STRUCTURE settles it anyway: a round-one slot feeds exactly one downstream position, so if
 * the next round names somebody who is not that match's other player, the placeholder was that
 * person and they won. If the next round names the other player, the placeholder lost and the page
 * never records who they were — that is unknowable, and it is reported as unknowable rather than
 * guessed from who else happens to appear nearby.
 *
 * ── The captures ────────────────────────────────────────────────────────────────────────────────
 * Each archived file preserves the Wayback header it was taken from: the source URL, how many
 * captures exist and the range they span. That is what answers "is there a better capture?" without
 * fetching anything: when every capture of a 2009 page was taken between 2016 and 2019, a `tbd` in
 * it is not a capture that arrived too early. It is what the site itself still said seven years
 * later, and no other snapshot will differ.
 *
 * Read-only. Usage: tsx scripts/archive-source-blockers.mts
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry } from '../src/lib/archive/manifest.ts'
import { parseWayback } from '../src/lib/archive/wayback.ts'
import { auditSeason } from './support/season-audit.mts'

assertLocalDatabase()

const PLACEHOLDER = /^(tbd|t\.b\.d\.?|\?+|-+|n\/a|unknown|vacant)$/i

/** The Wayback header the capture was saved with, when the file kept it. */
function captureMeta(text: string): { sourceUrl: string | null; captureCount: number | null; range: string | null } {
  const url = text.match(/https?:\/\/(?:www\.)?8brcam\.com\/[^\s"']+/i)?.[0]
    ?? text.match(/web\.archive\.org\/web\/\d{14}\/(\S+)/i)?.[1] ?? null
  const count = text.match(/(\d+)\s+captures/i)?.[1]
  const range = text.match(/(\d{1,2}\s+\w{3}\s+\d{4})\s*-\s*(\d{1,2}\s+\w{3}\s+\d{4})/)
  return {
    sourceUrl: url,
    captureCount: count ? Number(count) : null,
    range: range ? `${range[1]} — ${range[2]}` : null,
  }
}

interface PlaceholderSlot {
  season: string
  seasonId: number
  round: number
  roundLabel: string
  position: number
  side: 'home' | 'away'
  opponent: string | null
  score: string | null
  advancesTo: { round: number; position: number; side: string } | null
  downstreamNames: string | null
  verdict: 'PROVEN_BY_STRUCTURE' | 'UNKNOWABLE_LOST' | 'UNKNOWABLE_NO_DOWNSTREAM'
  reasoning: string
}

interface SeasonRow {
  seasonId: number
  season: string
  lifecycleState: string
  capture: { file: string; sourceUrl: string | null; captureCount: number | null; range: string | null; category: string | null }
  manifest: { participants: number; groups: number; matches: number; playoffField: number; placement: string }
  database: { entrants: number; groups: number; standings: number; groupMatches: number; playoffMatches: number; champion: string | null }
  supportedTarget: string
  placeholderSlots: number
  manifestPlaceholders: number
  failingChecks: string[]
  attribution: { source: number; identity: number; genuine: number }
  status: 'VERIFIED' | 'SOURCE_BLOCKED' | 'IDENTITY_PENDING' | 'FAILED'
  blockers: string[]
}

const seasons = await prisma.season.findMany({
  where: { archiveTemplateKey: { not: null }, division: 'A' },
  select: {
    id: true, number: true, division: true, competitionYear: true,
    archiveTemplateKey: true, lifecycleState: true, championName: true,
  },
  orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }],
})

/** Identity blockers per Season, from the queue this pairs with. */
const queuePath = 'reports/archive-identity-queue.json'
const queue = existsSync(queuePath) ? JSON.parse(readFileSync(queuePath, 'utf8')) : { items: [] }
const identityBySeason = new Map<number, Set<string>>()
for (const item of queue.items ?? []) {
  if (item.category === 'ORPHANED_REFERENCE') continue
  for (const a of item.appearances ?? []) {
    if (!identityBySeason.has(a.seasonId)) identityBySeason.set(a.seasonId, new Set())
    identityBySeason.get(a.seasonId)!.add(item.rawHandles?.[0] ?? item.key)
  }
}

const slots: PlaceholderSlot[] = []
const rows: SeasonRow[] = []

for (const s of seasons) {
  const label = `${s.competitionYear} S${s.number}${s.division ?? ''}`
  const entry = manifestEntry(s.archiveTemplateKey!)
  const file = `archive/wayback-seasons/${s.competitionYear}/${s.competitionYear} s${s.number}.txt`
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : null
  const page = raw ? parseWayback(raw, file) : null
  const meta = raw ? captureMeta(raw) : { sourceUrl: null, captureCount: null, range: null }

  // ── Placeholder slots, and whether the bracket structure settles them ────────────────────────
  let seasonSlots = 0
  if (page) {
    const at = new Map(page.matches.map((m) => [`${m.round}:${m.position}`, m]))
    for (const m of page.matches) {
      for (const side of ['home', 'away'] as const) {
        const p = m[side]
        if (!p || p.bye || !PLACEHOLDER.test(p.rawHandle.trim())) continue
        seasonSlots++
        const other = side === 'home' ? m.away : m.home
        const adv = m.advancesTo
        const down = adv ? at.get(`${adv.round}:${adv.position}`) : null
        const downPlayer = down ? (adv!.side === 'home' ? down.home : down.away) : null
        const downName = downPlayer && !downPlayer.bye ? downPlayer.rawHandle : null

        let verdict: PlaceholderSlot['verdict'] = 'UNKNOWABLE_NO_DOWNSTREAM'
        let reasoning = 'the page records nothing downstream of this slot, so nothing constrains who filled it'

        if (downName) {
          const sameAsOpponent = other && downName.trim().toLowerCase() === other.rawHandle.trim().toLowerCase()
          if (sameAsOpponent) {
            verdict = 'UNKNOWABLE_LOST'
            reasoning = `the winner carried forward is ${other!.rawHandle}, this slot's opponent — so the placeholder lost and the page never names them anywhere`
          } else if (PLACEHOLDER.test(downName.trim())) {
            verdict = 'UNKNOWABLE_NO_DOWNSTREAM'
            reasoning = 'the downstream slot is itself a placeholder'
          } else {
            verdict = 'PROVEN_BY_STRUCTURE'
            reasoning = `this slot feeds exactly one position (R${adv!.round}.${adv!.position} ${adv!.side}), and that position names ${downName}, who is not this match's other player — so the placeholder was ${downName}`
          }
        }

        slots.push({
          season: label, seasonId: s.id, round: m.round, roundLabel: m.roundLabel, position: m.position, side,
          opponent: other?.rawHandle ?? null, score: m.rawScore,
          advancesTo: adv ? { round: adv.round, position: adv.position, side: adv.side } : null,
          downstreamNames: downName, verdict, reasoning,
        })
      }
    }
  }

  /*
   * Placeholders are not only a property of the PAGE.
   *
   * 2011 S2A and 2011 S5A each carry seven literal `tbd` entries in the manifest's own playoff
   * field -- the recorded field names seven positions nobody ever filled in. Counting only the
   * bracket page missed them, and a Season whose recorded field is part placeholder cannot have
   * that field verified against anything.
   */
  const manifestPlaceholders = [...(entry?.participants ?? []), ...(entry?.playoff.participants ?? [])]
    .filter((p) => PLACEHOLDER.test(String(p.rawHandle).trim())).length
  seasonSlots += manifestPlaceholders

  const [entrants, groups, standings, groupMatches, playoffMatches] = await Promise.all([
    prisma.seasonEntrant.count({ where: { seasonId: s.id, status: 'APPROVED' } }),
    prisma.seasonGroup.count({ where: { seasonId: s.id } }),
    prisma.seasonStanding.count({ where: { seasonId: s.id } }),
    prisma.seasonMatch.count({ where: { seasonId: s.id } }),
    prisma.seasonPlayoffMatch.count({ where: { seasonId: s.id } }),
  ])

  const mParticipants = entry?.participants.length ?? 0
  const mGroups = entry ? new Set(entry.participants.map((p) => p.groupName)).size : 0
  const identity = [...(identityBySeason.get(s.id) ?? [])]

  const blockers: string[] = []
  if (seasonSlots) blockers.push(`${seasonSlots} placeholder slot(s)` + (manifestPlaceholders ? ` (${manifestPlaceholders} in the manifest's playoff field)` : ' on the page'))
  if (identity.length) blockers.push(`${identity.length} handle(s) awaiting an identity decision`)

  let supportedTarget: string
  if (mParticipants === 0 && page && page.validation.category !== 'unusable') {
    supportedTarget = `playoff only — the manifest names nobody, the page carries a ${page.bracketSize}-player bracket`
  } else if (mParticipants === 0) {
    supportedTarget = 'unknown — neither the manifest nor a usable page describes this Season'
    blockers.push('the manifest records no participants and the page is not usable')
  } else {
    supportedTarget = `${mParticipants} entrants in ${mGroups} group(s); playoff field ${entry?.playoff.participants.length ?? 0} (${entry?.playoff.placement})`
  }

  /*
   * ── The verification contract ────────────────────────────────────────────────────────────────
   * A Season's status is derived from WHICH checks fail and what the sources could ever have said
   * about them, not from a guess about the Season as a whole. Each failing check is attributed:
   *
   *   source-blocked   the check needs evidence this capture does not contain -- a manifest that
   *                    names nobody, a page that cannot be read, a slot the page left as `tbd`.
   *   identity-pending the source names somebody the database cannot yet place, and the owner has
   *                    not yet said who they are.
   *   genuine          the database disagrees with evidence that exists. Only this is a defect, and
   *                    only this a repair can fix.
   *
   * A Season is VERIFIED when nothing fails; FAILED when anything genuine fails; otherwise it takes
   * the more severe of the two remaining kinds. Crucially, the "nothing was invented" checks are
   * never attributable: a source-blocked Season still has to prove it made nothing up.
   */
  const audit = await auditSeason(s.id)
  const failing = audit.checks.filter((c) => !c.ok).map((c) => c.label)

  const NEEDS_MANIFEST = [
    'entrant count matches the archive', 'group count matches the archive',
    'every archived result was imported', 'every archived standing row matches a recomputed one',
    'the schedule is a full round robin', 'the recorded playoff field is selected',
    'a standing exists for every grouped player',
  ]
  const NEEDS_PAGE = [
    'every recorded Round 1 position is seated', 'the bracket is the size the archive records',
    'every decided match is one the page records', 'every forfeit is one the page records',
    'an unrecorded topology is only seated where the archived page records it',
    'no disqualification was given a score',
  ]
  const NEEDS_IDENTITY = [
    'every recorded handle resolves to exactly one entrant', 'no entrant exists outside the archive record',
    'every grouped player is in the group the archive lists',
    'every archived score sits on the fixture between the right two players',
    'every archived score has the archived value, the right way round',
  ]
  const startsWithAny = (label: string, list: string[]) => list.some((p) => label.startsWith(p))

  const manifestSilent = mParticipants === 0
  const pageUnusable = !page || page.validation.category === 'unusable' || page.validation.category === 'placement-only'

  const attributed = failing.map((label) => {
    if (manifestSilent && startsWithAny(label, NEEDS_MANIFEST)) return 'source'
    if ((pageUnusable || seasonSlots > 0) && startsWithAny(label, NEEDS_PAGE)) return 'source'
    if (identity.length > 0 && startsWithAny(label, NEEDS_IDENTITY)) return 'identity'
    return 'genuine'
  })

  const status: SeasonRow['status'] =
    failing.length === 0 ? 'VERIFIED'
    : attributed.includes('genuine') ? 'FAILED'
    : attributed.includes('source') ? 'SOURCE_BLOCKED'
    : 'IDENTITY_PENDING'

  for (const [i, label] of failing.entries()) {
    if (attributed[i] === 'genuine') blockers.push(`contradicts existing evidence: ${label}`)
  }

  rows.push({
    seasonId: s.id, season: label, lifecycleState: String(s.lifecycleState),
    capture: { file, sourceUrl: meta.sourceUrl, captureCount: meta.captureCount, range: meta.range, category: page?.validation.category ?? null },
    manifest: {
      participants: mParticipants, groups: mGroups, matches: entry?.matches.length ?? 0,
      playoffField: entry?.playoff.participants.length ?? 0, placement: entry?.playoff.placement ?? 'none',
    },
    database: { entrants, groups, standings, groupMatches, playoffMatches, champion: s.championName },
    supportedTarget, placeholderSlots: seasonSlots, manifestPlaceholders,
    failingChecks: failing,
    attribution: {
      source: attributed.filter((x) => x === 'source').length,
      identity: attributed.filter((x) => x === 'identity').length,
      genuine: attributed.filter((x) => x === 'genuine').length,
    },
    status, blockers,
  })
}

mkdirSync('reports', { recursive: true })
writeFileSync('reports/archive-source-blockers.json', JSON.stringify({ seasons: rows, placeholderSlots: slots }, null, 2))

console.log('--- Placeholder slots ---')
const byVerdict = (v: string) => slots.filter((x) => x.verdict === v)
for (const v of ['PROVEN_BY_STRUCTURE', 'UNKNOWABLE_LOST', 'UNKNOWABLE_NO_DOWNSTREAM']) {
  console.log(`  ${v.padEnd(28)} ${byVerdict(v).length}`)
}
for (const x of byVerdict('PROVEN_BY_STRUCTURE')) {
  console.log(`    ${x.season} R${x.round}.${x.position} ${x.side} -> ${x.downstreamNames}`)
}

console.log('\n--- Season status ---')
for (const st of ['VERIFIED', 'SOURCE_BLOCKED', 'IDENTITY_PENDING', 'FAILED'] as const) {
  const n = rows.filter((r) => r.status === st).length
  if (n) console.log(`  ${st.padEnd(18)} ${n}`)
}
console.log('\n--- Captures for the placeholder Seasons ---')
for (const r of rows.filter((x) => x.placeholderSlots > 0)) {
  console.log(`  ${r.season}: ${r.capture.captureCount ?? '?'} capture(s), ${r.capture.range ?? 'range unknown'}`)
  console.log(`      ${r.capture.sourceUrl ?? 'source url not preserved'}`)
}
console.log('\nwritten: reports/archive-source-blockers.json')

await prisma.$disconnect()
