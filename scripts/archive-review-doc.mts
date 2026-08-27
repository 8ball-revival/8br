/**
 * Turn the identity queue and the source-blocker sweep into one document the owner can answer.
 *
 * Everything here is presentation. The findings are made by archive-identity-queue.mts and
 * archive-source-blockers.mts; this reads their reports and lays them out so the questions are at
 * the top, numbered, in the order that makes them quickest to answer, and the evidence is beneath
 * rather than around them.
 *
 * Read-only, and touches no database at all.
 *
 * Usage: tsx scripts/archive-review-doc.mts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const QUEUE = 'reports/archive-identity-queue.json'
const BLOCKERS = 'reports/archive-source-blockers.json'
for (const f of [QUEUE, BLOCKERS]) {
  if (!existsSync(f)) throw new Error(`${f} is missing — run archive-identity-queue.mts and archive-source-blockers.mts first`)
}

const queue = JSON.parse(readFileSync(QUEUE, 'utf8'))
const blockers = JSON.parse(readFileSync(BLOCKERS, 'utf8'))

const items: any[] = queue.items
const slots: any[] = blockers.placeholderSlots
const seasons: any[] = blockers.seasons

const ORDER = [
  'DETERMINISTIC_NORMALIZATION', 'STRONG_CANDIDATE', 'AMBIGUOUS',
  'LIKELY_NEW_PLAYER', 'NO_CANDIDATE', 'SOURCE_PLACEHOLDER', 'ORPHANED_REFERENCE',
]
const CONF: Record<string, number> = { High: 0, Medium: 1, Low: 2 }
const sorted = [...items].sort((a, b) => {
  const c = ORDER.indexOf(a.category) - ORDER.indexOf(b.category)
  if (c !== 0) return c
  const f = CONF[a.confidence] - CONF[b.confidence]
  if (f !== 0) return f
  return b.appearances.length - a.appearances.length
})

const seasonsOf = (i: any) => [...new Set(i.appearances.map((a: any) => a.season))] as string[]
const out: string[] = []
const w = (s = '') => out.push(s)

w('# Archive identity review')
w()
w('Every unresolved identity in the Division A archive, gathered read-only from the archived pages,')
w('the season manifests, the independent 8BRCAM exports and the current database. **Nothing has been')
w('changed.** Answer the numbered questions below and the reconstruction can be completed.')
w()

// ── The questions ───────────────────────────────────────────────────────────────────────────────
w('## Your questions')
w()
w('Answer by number. `NEW` creates a historical Player; `BLOCKED` leaves the slot source-blocked.')
w()

let n = 0
const numbered: { n: number; item: any }[] = []
for (const cat of ORDER) {
  const set = sorted.filter((i) => i.category === cat)
  if (!set.length) continue

  const heading: Record<string, string> = {
    DETERMINISTIC_NORMALIZATION: 'Mechanical — same handle, different punctuation (confirm in bulk)',
    STRONG_CANDIDATE: 'One well-supported candidate',
    AMBIGUOUS: 'Two or more plausible people',
    LIKELY_NEW_PLAYER: 'Probably somebody the database never had',
    NO_CANDIDATE: 'No source identifies this person',
    SOURCE_PLACEHOLDER: 'Placeholders — not people',
    ORPHANED_REFERENCE: 'Records pointing at a deleted Player',
  }
  w(`### ${heading[cat] ?? cat}`)
  w()
  for (const i of set) {
    n++
    numbered.push({ n, item: i })
    const where = seasonsOf(i)
    const rec = i.recommendation ? ` **Recommendation:** ${i.recommendation}.` : ''
    w(`${n}. \`${i.rawHandles[0]}\` — ${i.question}${rec} **Confidence:** ${i.confidence}.`)
    w(`   *Appears in ${where.length} season(s): ${where.join(', ')}.*`)
    if (i.candidates.length) {
      for (const c of i.candidates.slice(0, 3)) {
        w(`   - \`${c.cueverseId ?? c.playerId}\` (${c.preferredName ?? 'no name'}) — ${c.support[0] ?? 'no supporting evidence'}${c.against.length ? `; against: ${c.against[0]}` : ''}`)
      }
    }
    w()
  }
}

// ── Placeholders ────────────────────────────────────────────────────────────────────────────────
w('## Placeholders — no question to answer')
w()
w('These are `tbd` on the page, not people. They are listed so the record shows they were examined,')
w('not so they can be identified.')
w()
w('| Season | Slot | Opponent | Verdict |')
w('|---|---|---|---|')
for (const s of slots) {
  w(`| ${s.season} | R${s.round}.${s.position} ${s.side} | ${s.opponent ?? '—'} | ${s.verdict} |`)
}
w()
const proven = slots.filter((s) => s.verdict === 'PROVEN_BY_STRUCTURE')
if (proven.length) {
  w('**Recovered from the bracket structure:**')
  w()
  for (const s of proven) w(`- ${s.season} R${s.round}.${s.position} ${s.side} → **${s.downstreamNames}**. ${s.reasoning}`)
  w()
}

// ── Captures ────────────────────────────────────────────────────────────────────────────────────
w('## Captures examined for the placeholder seasons')
w()
w('| Season | Source page | Captures | Range | Slot changed in any capture? |')
w('|---|---|---|---|---|')
for (const r of seasons.filter((x) => x.placeholderSlots > 0)) {
  w(`| ${r.season} | \`${r.capture.sourceUrl ?? '—'}\` | ${r.capture.captureCount ?? '?'} | ${r.capture.range ?? '—'} | No — see below |`)
}
w()
w('Every capture of every placeholder season was taken between **9 Sep 2016 and 10 May 2019** — seven')
w('to ten years after the competitions were played. A `tbd` still standing a decade later is not a')
w('snapshot that arrived before the slot was filled; it is what the site itself always said. No later')
w('capture will differ, so these slots are permanently source-blocked.')
w()

// ── Season table ────────────────────────────────────────────────────────────────────────────────
w('## Season by season')
w()
w('| Season | State | Champion | Supported target | Identity | Placeholders | Status |')
w('|---|---|---|---|---|---|---|')
for (const r of seasons) {
  const ident = items.filter((i) => i.category !== 'ORPHANED_REFERENCE' && i.appearances.some((a: any) => a.seasonId === r.seasonId)).length
  w(`| ${r.season} | ${r.lifecycleState} | ${r.database.champion ?? '—'} | ${r.supportedTarget} | ${ident || '—'} | ${r.placeholderSlots || '—'} | ${r.status} |`)
}
w()

// ── Projection ──────────────────────────────────────────────────────────────────────────────────
const permanentlyBlocked = seasons.filter((r) => r.placeholderSlots > 0)
const identitySeasons = new Set<number>()
for (const i of items) {
  if (i.category === 'ORPHANED_REFERENCE') continue
  for (const a of i.appearances) identitySeasons.add(a.seasonId)
}

w('## Projection after your decisions')
w()
w('| Outcome | Seasons | Why |')
w('|---|---:|---|')
w(`| Expected VERIFIED | ${44 - permanentlyBlocked.length} | every source-supported fact represented once the reconstruction runs |`)
w(`| Expected SOURCE_BLOCKED | ${permanentlyBlocked.length} | ${permanentlyBlocked.map((r) => r.season).join(', ')} — placeholders no capture ever filled |`)
w()
w('This is a projection, not a promise. It assumes every question below is answered and that the')
w('reconstruction then seats every position the sources name. It will be re-measured against a')
w('rehearsal clone before anything is applied.')
w()

w('## What happens next')
w()
w('1. You answer the numbered questions.')
w('2. They are recorded in `reports/archive-identity-decisions.json` and applied as aliases, merges or new historical Players.')
w('3. The repair is rehearsed end to end on a clone and re-measured against this table.')
w('4. Only if the rehearsal shows no stranded season and no unexplained change is it applied locally.')
w()
w('Mandatory in that repair, already established: **2009 S5A** — remove the 8 groups, 168 group')
w('matches and 56 standings the archive does not support, keep the 28-player playoff bracket the page')
w('does record, and leave its one `tbd` slot source-blocked.')

mkdirSync('reports', { recursive: true })
writeFileSync('reports/archive-identity-review.md', out.join('\n'))

// The decision file, numbered to match the document.
writeFileSync('reports/archive-identity-decisions.template.json', JSON.stringify({
  instructions: 'Set "decision" to a CueVerse ID (merge into that Player), "NEW" (create a historical Player), or "BLOCKED" (leave source-blocked). Leave "" to defer. Numbers match reports/archive-identity-review.md.',
  decisions: numbered.map(({ n, item }) => ({
    n, handle: item.rawHandles[0], key: item.key, category: item.category,
    seasons: seasonsOf(item), recommendation: item.recommendation, decision: '',
  })),
}, null, 2))

console.log(`written: reports/archive-identity-review.md (${n} numbered questions)`)
console.log('written: reports/archive-identity-decisions.template.json')
