/**
 * Every unresolved identity in the Division A archive, with the evidence for and against each.
 *
 * ── Why a queue and not a resolver ──────────────────────────────────────────────────────────────
 * The Division A reconstruction stops on handles the bracket seats that resolve to no entrant. Each
 * one is a question — "is this person somebody the database already has, or somebody new?" — and
 * getting it wrong attaches a competitive record to the wrong player, which is far harder to undo
 * than merging two later. So nothing here decides anything. It gathers what every available source
 * says about each handle and puts the decision in front of the owner once, in a batch.
 *
 * ── The sources, and why more than one ──────────────────────────────────────────────────────────
 * The database and the season manifest are the same story told twice: both descend from the import.
 * The 8BRCAM legacy exports are INDEPENDENT of them — a different capture of the same competitions,
 * with its own player table, its own alias table and its own per-season playoff seeds. When a handle
 * the manifest cannot place appears in the legacy seeds beside a player whose other spellings the
 * database already holds, that is corroboration from outside the thing being checked.
 *
 * Read-only, and deliberately: it reads the database, the archived pages and the exports, and writes
 * only reports.
 *
 * Usage: tsx scripts/archive-identity-queue.mts
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry, stripSourceNote } from '../src/lib/archive/manifest.ts'
import { parseWayback, normaliseHandle } from '../src/lib/archive/wayback.ts'
import { resolveCanonical } from '../src/lib/archive/canonical-identity.ts'

assertLocalDatabase()

// ── Keys ────────────────────────────────────────────────────────────────────────────────────────
/** The handle as the resolver sees it: source note stripped, normalised, lower-cased. */
const norm = (h: string) => normaliseHandle(stripSourceNote(h)).toLowerCase().trim()
/**
 * The handle with every separator and decoration removed.
 *
 * `adam_buddy`, `adambuddy` and `Adam.Buddy` collapse to one key. This is what makes a difference
 * that is purely typographic provable rather than merely plausible — the alias table already
 * normalises this way, and the resolver was for a while the only place still demanding that the
 * punctuation match.
 */
const bare = (h: string) => norm(h).replace(/[^a-z0-9]/g, '')

/** Edit distance, capped so a long-shot pair costs nothing to reject. */
function distance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      best = Math.min(best, row[j])
    }
    if (best > cap) return cap + 1
    prev = row
  }
  return prev[b.length]
}

// ── The 8BRCAM legacy exports, an independent capture ───────────────────────────────────────────
const CSV_DIR = 'archive/cueverse-prime/data/csv'
/** Minimal CSV reader: these files are machine-written, but a name may still be quoted. */
function readCsv(file: string): Record<string, string>[] {
  const path = `${CSV_DIR}/${file}`
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)
  const head = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const cells: string[] = []
    let cur = '', quoted = false
    for (const ch of line) {
      if (ch === '"') quoted = !quoted
      else if (ch === ',' && !quoted) { cells.push(cur); cur = '' }
      else cur += ch
    }
    cells.push(cur)
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']))
  })
}

interface LegacyPlayer {
  legacyId: string
  primaryName: string
  handles: Set<string>
  seasons: Set<string>
}

const legacyById = new Map<string, LegacyPlayer>()
const legacyByHandle = new Map<string, Set<string>>()
const noteLegacyHandle = (h: string, legacyId: string) => {
  const k = bare(h)
  if (!k) return
  if (!legacyByHandle.has(k)) legacyByHandle.set(k, new Set())
  legacyByHandle.get(k)!.add(legacyId)
  legacyById.get(legacyId)?.handles.add(norm(h))
}

for (const r of readCsv('players.csv')) {
  legacyById.set(r.player_id, {
    legacyId: r.player_id, primaryName: r.primary_name ?? '', handles: new Set(), seasons: new Set(),
  })
  if (r.primary_ym) noteLegacyHandle(r.primary_ym, r.player_id)
}
for (const r of readCsv('player_aliases.csv')) {
  if (legacyById.has(r.player_id) && r.alias) noteLegacyHandle(r.alias, r.player_id)
}
for (const r of readCsv('playoff_seeds.csv')) {
  if (!legacyById.has(r.player_id)) continue
  if (r.handle) noteLegacyHandle(r.handle, r.player_id)
  if (r.season_id) legacyById.get(r.player_id)!.seasons.add(`${r.season_id}${r.division && r.division !== 'single' ? `/${r.division}` : ''}`)
}

// ── The canonical Players the database holds now ────────────────────────────────────────────────
const players = await prisma.player.findMany({
  select: { id: true, cueverseId: true, cueverseIdNormalized: true, primaryName: true },
})
const aliasRows = await prisma.playerAlias.findMany({ select: { playerId: true, alias: true } })

const aliasesByPlayer = new Map<string, string[]>()
for (const a of aliasRows) {
  if (!aliasesByPlayer.has(a.playerId)) aliasesByPlayer.set(a.playerId, [])
  aliasesByPlayer.get(a.playerId)!.push(a.alias)
}

/** Every spelling that points at a canonical Player, bare-keyed. */
const canonicalByBare = new Map<string, Set<string>>()
const addCanonical = (spelling: string, playerId: string) => {
  const k = bare(spelling)
  if (!k) return
  if (!canonicalByBare.has(k)) canonicalByBare.set(k, new Set())
  canonicalByBare.get(k)!.add(playerId)
}
for (const p of players) if (p.cueverseId) addCanonical(p.cueverseId, p.id)
for (const a of aliasRows) addCanonical(a.alias, a.playerId)

const playerById = new Map(players.map((p) => [p.id, p]))

/** Which archive Seasons a canonical Player is already entered in — corroboration, not proof. */
const entrantRows = await prisma.seasonEntrant.findMany({
  where: { season: { archiveTemplateKey: { not: null } } },
  select: { playerId: true, seasonId: true, season: { select: { competitionYear: true, number: true, division: true } } },
})
const seasonsByPlayer = new Map<string, Set<string>>()
for (const e of entrantRows) {
  if (!e.playerId) continue
  if (!seasonsByPlayer.has(e.playerId)) seasonsByPlayer.set(e.playerId, new Set())
  seasonsByPlayer.get(e.playerId)!.add(`${e.season.competitionYear} S${e.season.number}${e.season.division ?? ''}`)
}

// ── Which captures exist for each Season, so the sweep can say what it looked at ────────────────
function capturesFor(year: number, number: number): string[] {
  const dir = `archive/wayback-seasons/${year}`
  if (!existsSync(dir)) return []
  const want = [`${year} s${number}.txt`, `paste-${year}-s${number}.txt`, `raw-${year}-s${number}.html`]
  return readdirSync(dir).filter((f) => want.includes(f)).map((f) => `${dir}/${f}`)
}

// ── Sweep every Division A archive Season ───────────────────────────────────────────────────────
type Category =
  | 'DETERMINISTIC_NORMALIZATION' | 'STRONG_CANDIDATE' | 'AMBIGUOUS' | 'LIKELY_NEW_PLAYER'
  | 'NO_CANDIDATE' | 'SOURCE_PLACEHOLDER' | 'ORPHANED_REFERENCE'

interface Appearance {
  seasonId: number
  season: string
  year: number
  division: string
  round: number | null
  roundLabel: string | null
  position: number | null
  side: 'home' | 'away' | null
  opponentRaw: string | null
  score: string | null
  outcome: string | null
  sourceFile: string
  captures: string[]
  inManifest: boolean
  inBracket: boolean
}

interface Candidate {
  playerId: string
  cueverseId: string | null
  preferredName: string | null
  aliases: string[]
  seasons: string[]
  support: string[]
  against: string[]
  score: number
}

interface QueueItem {
  key: string
  rawHandles: string[]
  normalized: string
  category: Category
  confidence: 'High' | 'Medium' | 'Low'
  appearances: Appearance[]
  candidates: Candidate[]
  recommendation: string
  question: string
  legacy: { legacyIds: string[]; names: string[]; handles: string[]; seasons: string[] }
}

const PLACEHOLDER = /^(tbd|t\.b\.d\.?|bye|\?+|-+|n\/a|unknown|vacant)$/i

const seasons = await prisma.season.findMany({
  where: { archiveTemplateKey: { not: null }, division: 'A' },
  select: { id: true, number: true, division: true, competitionYear: true, archiveTemplateKey: true, lifecycleState: true },
  orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }],
})

const items = new Map<string, QueueItem>()
const placeholders: Appearance[] = []
const seasonBlockers = new Map<number, { season: string; identity: Set<string>; autoEnterable: Set<string>; placeholders: number; note: string[] }>()

const noteBlocker = (seasonId: number, season: string) => {
  if (!seasonBlockers.has(seasonId)) seasonBlockers.set(seasonId, { season, identity: new Set(), autoEnterable: new Set(), placeholders: 0, note: [] })
  return seasonBlockers.get(seasonId)!
}

for (const s of seasons) {
  const label = `${s.competitionYear} S${s.number}${s.division ?? ''}`
  const entry = manifestEntry(s.archiveTemplateKey!)
  const file = `archive/wayback-seasons/${s.competitionYear}/${s.competitionYear} s${s.number}.txt`
  const captures = capturesFor(s.competitionYear, s.number)
  const page = existsSync(file) ? parseWayback(readFileSync(file, 'utf8'), file) : null
  const blocker = noteBlocker(s.id, label)

  /** Each handle the sources name, with where it was seen. */
  const seen: { raw: string; ap: Omit<Appearance, 'captures'> }[] = []

  if (page) {
    for (const m of page.matches) {
      for (const side of ['home', 'away'] as const) {
        const p = m[side]
        if (!p || p.bye) continue
        const other = side === 'home' ? m.away : m.home
        seen.push({
          raw: p.rawHandle,
          ap: {
            seasonId: s.id, season: label, year: s.competitionYear, division: s.division ?? 'A',
            round: m.round, roundLabel: m.roundLabel, position: m.position, side,
            opponentRaw: other?.rawHandle ?? null,
            score: m.rawScore, outcome: m.outcome, sourceFile: file,
            inManifest: false, inBracket: true,
          },
        })
      }
    }
  }
  if (entry) {
    for (const p of [...entry.participants, ...entry.playoff.participants]) {
      seen.push({
        raw: p.rawHandle,
        ap: {
          seasonId: s.id, season: label, year: s.competitionYear, division: s.division ?? 'A',
          round: null, roundLabel: null, position: null, side: null,
          opponentRaw: null, score: null, outcome: null,
          sourceFile: `manifest:${s.archiveTemplateKey}`, inManifest: true, inBracket: false,
        },
      })
    }
  }

  for (const { raw, ap } of seen) {
    const cleaned = stripSourceNote(raw).trim()
    if (!cleaned) continue

    if (PLACEHOLDER.test(cleaned)) {
      placeholders.push({ ...ap, captures })
      blocker.placeholders++
      continue
    }

    const id = await resolveCanonical(s.id, raw)
    /*
     * Only an UNRESOLVED handle is a question for the owner.
     *
     * A handle that resolves to a known Player who simply has no entrant row in this Season is a
     * different thing entirely: the reconstruction enters them itself, from the bracket, which is
     * exactly what archive-enter-bracket-field exists to do. Putting those in the queue would ask
     * the owner to identify people the database has already identified -- it inflated an earlier
     * run of this sweep from tens of questions to 167.
     */
    if (id.resolution === 'resolved') {
      if (!id.entrantId) blocker.autoEnterable.add(bare(cleaned))
      continue
    }

    const key = bare(cleaned)
    if (!key) continue
    if (!items.has(key)) {
      items.set(key, {
        key, rawHandles: [], normalized: norm(cleaned), category: 'NO_CANDIDATE', confidence: 'Low',
        appearances: [], candidates: [], recommendation: '', question: '',
        legacy: { legacyIds: [], names: [], handles: [], seasons: [] },
      })
    }
    const item = items.get(key)!
    if (!item.rawHandles.includes(cleaned)) item.rawHandles.push(cleaned)
    item.appearances.push({ ...ap, captures })
    blocker.identity.add(key)
  }
}

// ── Candidates and classification ───────────────────────────────────────────────────────────────
for (const item of items.values()) {
  const key = item.key
  const seasonsOfItem = new Set(item.appearances.map((a) => a.season))

  const add = new Map<string, Candidate>()
  const cand = (playerId: string): Candidate => {
    if (!add.has(playerId)) {
      const p = playerById.get(playerId)
      add.set(playerId, {
        playerId,
        cueverseId: p?.cueverseId ?? null,
        preferredName: p?.primaryName ?? null,
        aliases: aliasesByPlayer.get(playerId) ?? [],
        seasons: [...(seasonsByPlayer.get(playerId) ?? [])].sort(),
        support: [], against: [], score: 0,
      })
    }
    return add.get(playerId)!
  }

  // 1. Same spelling once separators and decoration are removed — mechanically provable.
  let deterministic = false
  for (const pid of canonicalByBare.get(key) ?? []) {
    const c = cand(pid)
    /*
     * Say WHICH spelling matched. A Player is reachable by their CueVerse ID and by every alias a
     * rename left behind, so "identical to this Player" is ambiguous on its own -- the first draft
     * of this printed the Player's primary handle beside a key it did not resemble, which read as a
     * bug in the matching rather than a missing detail in the message.
     */
    const matched = [c.cueverseId ?? '', ...(aliasesByPlayer.get(pid) ?? [])].find((sp) => bare(sp) === key)
    const via = matched && bare(c.cueverseId ?? '') === key ? 'CueVerse ID' : 'alias'
    c.support.push(`identical to their ${via} "${matched ?? ''}" once separators and decoration are removed`)
    c.score += 100
    deterministic = true
  }

  // 2. The independent 8BRCAM export: this handle belongs to a legacy player whose OTHER spellings
  //    the database already holds.
  for (const legacyId of legacyByHandle.get(key) ?? []) {
    const lp = legacyById.get(legacyId)
    if (!lp) continue
    item.legacy.legacyIds.push(legacyId)
    if (lp.primaryName) item.legacy.names.push(lp.primaryName)
    item.legacy.handles.push(...[...lp.handles])
    item.legacy.seasons.push(...[...lp.seasons])
    for (const h of lp.handles) {
      for (const pid of canonicalByBare.get(bare(h)) ?? []) {
        const c = cand(pid)
        c.support.push(`the 8BRCAM export lists "${h}" and "${item.normalized}" as the same person (${legacyId}${lp.primaryName ? `, "${lp.primaryName}"` : ''})`)
        c.score += 60
      }
    }
  }

  // 3. One character out from a spelling the database holds. Weak alone, strong beside a Season.
  if (!deterministic) {
    for (const [k, pids] of canonicalByBare) {
      if (Math.abs(k.length - key.length) > 1) continue
      if (distance(k, key, 1) > 1) continue
      for (const pid of pids) {
        const c = cand(pid)
        c.support.push(`one character from "${k}", a spelling the database already holds`)
        c.score += 25
      }
    }
  }

  for (const c of add.values()) {
    const shared = c.seasons.filter((x) => seasonsOfItem.has(x))
    if (shared.length) {
      c.support.push(`already entered in ${shared.join(', ')} — the same Season this handle appears in`)
      c.score += 30
    }
    const adjacent = c.seasons.filter((x) => [...seasonsOfItem].some((y) => Math.abs(Number(x.slice(0, 4)) - Number(y.slice(0, 4))) <= 1))
    if (!shared.length && adjacent.length) {
      c.support.push(`plays in adjacent years (${adjacent.slice(0, 4).join(', ')})`)
      c.score += 10
    }
    if (!c.seasons.length) c.against.push('holds no archive record of their own, so nothing corroborates the match')
    if (shared.length && item.appearances.some((a) => a.inBracket)) {
      /*
       * Already entered AND seated by the bracket under a different spelling is the signature of the
       * mid-Season rename the owner described: the admins updated the draw and never went back to
       * the group table.
       */
      c.support.push('consistent with a mid-Season CueVerse ID change: entered under one spelling, drawn under another')
      c.score += 15
    }
  }

  item.candidates = [...add.values()].sort((a, b) => b.score - a.score)

  const top = item.candidates[0]
  const second = item.candidates[1]
  const clear = top && (!second || top.score - second.score >= 40)

  /*
   * More than one Player matching mechanically is not a mechanical answer.
   *
   * `t_r_a_v_i_s_` reduces to "travis", and so do TWO separate accounts. The normalisation rule is
   * what makes a case deterministic, so when it lands on more than one person it has not decided
   * anything -- and two live accounts sharing a normalised handle is itself worth the owner seeing.
   */
  const deterministicHits = (canonicalByBare.get(key) ?? new Set()).size
  if (deterministic && deterministicHits > 1) {
    item.category = 'AMBIGUOUS'
    item.confidence = 'Low'
    item.recommendation = 'no recommendation — more than one account normalises to this same handle'
    item.question = `${item.rawHandles[0]} — normalises to the same handle as ${item.candidates.slice(0, 3).map((c) => c.cueverseId ?? c.playerId).join(' and ')}. Which is it, or a new historical Player?`
  } else if (deterministic && clear) {
    item.category = 'DETERMINISTIC_NORMALIZATION'
    item.confidence = 'High'
    item.recommendation = `${top.cueverseId ?? top.playerId}`
    item.question = `"${item.rawHandles[0]}" differs from "${top.cueverseId}" only by punctuation or decoration. Confirm they are the same person?`
  } else if (top && clear && top.score >= 60) {
    item.category = 'STRONG_CANDIDATE'
    item.confidence = top.score >= 90 ? 'High' : 'Medium'
    item.recommendation = `${top.cueverseId ?? top.playerId}`
    item.question = `${item.rawHandles[0]} — is this ${top.cueverseId ?? top.preferredName}, or a new historical Player?`
  } else if (item.candidates.length >= 2) {
    item.category = 'AMBIGUOUS'
    item.confidence = 'Low'
    item.recommendation = 'no recommendation — the evidence does not separate them'
    item.question = `${item.rawHandles[0]} — is this ${item.candidates.slice(0, 3).map((c) => c.cueverseId ?? c.playerId).join(', ')}, or a new historical Player?`
  } else if (item.legacy.legacyIds.length > 0) {
    /*
     * The independent export knows this person and the database does not. That is the profile of
     * somebody who genuinely played and was never carried across, rather than a misspelling.
     */
    item.category = 'LIKELY_NEW_PLAYER'
    item.confidence = 'Medium'
    item.recommendation = 'create a new historical Player'
    item.question = `${item.rawHandles[0]} — the 8BRCAM export knows this handle (${item.legacy.legacyIds.join(', ')}) but the database has no matching account. Create a new historical Player?`
  } else {
    item.category = 'NO_CANDIDATE'
    item.confidence = 'Low'
    item.recommendation = 'leave source-blocked'
    item.question = `${item.rawHandles[0]} — no source identifies this person. Leave the slot source-blocked?`
  }
}

// ── Orphaned references ─────────────────────────────────────────────────────────────────────────
const orphanEntrants = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
  select e.id, e."seasonId", e."playerId", e.username, e."cueverseId", e.status,
         s."competitionYear", s.number, s.division
  from season_entrant e join season s on s.id = e."seasonId"
  where e."playerId" is not null and not exists (select 1 from "Player" p where p.id = e."playerId")`)

for (const o of orphanEntrants) {
  const label = `${o.competitionYear} S${o.number}${o.division ?? ''}`
  const key = `orphan:${o.id}`
  items.set(key, {
    key, rawHandles: [String(o.cueverseId ?? o.username ?? '')], normalized: norm(String(o.cueverseId ?? o.username ?? '')),
    category: 'ORPHANED_REFERENCE', confidence: 'High',
    appearances: [{
      seasonId: Number(o.seasonId), season: label, year: Number(o.competitionYear), division: String(o.division ?? 'A'),
      round: null, roundLabel: null, position: null, side: null, opponentRaw: null,
      score: null, outcome: String(o.status), sourceFile: 'database:season_entrant', captures: [],
      inManifest: false, inBracket: false,
    }],
    candidates: [], recommendation: 'delete the orphaned row',
    question: `${o.cueverseId ?? o.username} (${label}, status ${o.status}) points at a Player the 23 August reversal deleted. Delete this orphaned entrant row?`,
    legacy: { legacyIds: [], names: [], handles: [], seasons: [] },
  })
  noteBlocker(Number(o.seasonId), label).note.push('holds an entrant row pointing at a deleted Player')
}

// ── Output ──────────────────────────────────────────────────────────────────────────────────────
const ORDER: Category[] = [
  'DETERMINISTIC_NORMALIZATION', 'STRONG_CANDIDATE', 'AMBIGUOUS',
  'LIKELY_NEW_PLAYER', 'NO_CANDIDATE', 'SOURCE_PLACEHOLDER', 'ORPHANED_REFERENCE',
]
const CONF = { High: 0, Medium: 1, Low: 2 } as const

const all = [...items.values()].sort((a, b) => {
  const c = ORDER.indexOf(a.category) - ORDER.indexOf(b.category)
  if (c !== 0) return c
  const f = CONF[a.confidence] - CONF[b.confidence]
  if (f !== 0) return f
  return b.appearances.length - a.appearances.length
})

mkdirSync('reports', { recursive: true })
writeFileSync('reports/archive-identity-queue.json', JSON.stringify({
  generated: 'read-only sweep; no database rows were modified',
  counts: Object.fromEntries(ORDER.map((c) => [c, all.filter((i) => i.category === c).length])),
  placeholders: placeholders.length,
  items: all,
  sourcePlaceholders: placeholders,
}, null, 2))

// Decision template: one line per question, for the owner to fill in.
writeFileSync('reports/archive-identity-decisions.template.json', JSON.stringify({
  instructions: 'Set "decision" to a CueVerse ID (merge into that Player), "NEW" (create a historical Player), or "BLOCKED" (leave source-blocked). Leave "" to defer.',
  decisions: all.map((i, n) => ({
    n: n + 1, handle: i.rawHandles[0], key: i.key, category: i.category,
    seasons: [...new Set(i.appearances.map((a) => a.season))],
    recommendation: i.recommendation, decision: '',
  })),
}, null, 2))

console.log('--- Identity queue ---')
for (const c of ORDER) {
  const n = all.filter((i) => i.category === c).length
  if (n) console.log(`  ${c.padEnd(30)} ${n}`)
}
console.log(`  ${'SOURCE_PLACEHOLDER (slots)'.padEnd(30)} ${placeholders.length}`)
console.log(`\ntotal decisions required: ${all.length}`)
console.log('written: reports/archive-identity-queue.json, reports/archive-identity-decisions.template.json')

await prisma.$disconnect()
