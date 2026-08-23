/**
 * Turn an owner transcription of a bracket page into the tab-aligned layout the parser reads.
 *
 * ── Why a transcription needs converting at all ──────────────────────────────────────────────────
 * Ten Seasons' archived pages carry thirty-two seed numbers and nothing else: no names, no scores.
 * The brackets survive only in the rendered page, which the owner has read out as text. That text
 * loses one thing the original had — which side of the match each player sat on.
 *
 * ── Recovering the winner without guessing ───────────────────────────────────────────────────────
 * A bracket states its own results twice. Once as a score, and again by which of the two names
 * reappears in the next round. The second statement survives transcription intact, so it is the one
 * used here: the winner of a match is whichever of its two players the following round contains, and
 * the champion decides the final. The score is then read the only way a race can be read — the
 * winner holds the higher number.
 *
 * That is a reading of the source, not a repair of it. Where the two statements cannot be reconciled
 * — neither player appears in the next round, or both do — this refuses rather than picking one.
 *
 * The output goes through the ordinary parser, so the transcription is held to the same validation,
 * the same refusal to invent a score, and the same bye and forfeit handling as every other Season.
 *
 * Usage: tsx scripts/archive-transcribe-bracket.mts [--apply] [--year YYYY]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ARGS = process.argv.slice(2)
const APPLY = ARGS.includes('--apply')
const ONLY_YEAR = ARGS.includes('--year') ? ARGS[ARGS.indexOf('--year') + 1] : null

/** Tokens that state an outcome rather than name a player. */
const RESULT = /^(?:\d{1,3}\s*-\s*\d{1,3}(?:\s*\(.*\))?|BYE|DQ|Forfeit|FF['’]?d?|W\s*\/?\s*O|\d{1,3}\s*-\s*FF['’]?d?|FF['’]?d?\s*-\s*\d{1,3})$/i
/** Tokens that stand in for an absent opponent. */
const EMPTY_SIDE = /^(?:BYE|-|--|—)$/i

const SCORE = /^(\d{1,3})\s*-\s*(\d{1,3})(.*)$/

interface Match { a: string; result: string | null; b: string | null }

/** Read one round of matches off the front of the token list. */
function takeRound(tokens: string[], count: number, at: number): { matches: Match[]; next: number } {
  const matches: Match[] = []
  let i = at
  while (matches.length < count) {
    if (i >= tokens.length) throw new Error(`ran out of tokens after ${matches.length} of ${count} matches`)
    const a = tokens[i++]
    const t2 = tokens[i]
    if (t2 !== undefined && RESULT.test(t2)) {
      i++
      const t3 = tokens[i]
      // "name BYE" is a bye on its own; "name 7-0 BYE" is a bye with the walkover score printed.
      if (EMPTY_SIDE.test(t2)) matches.push({ a, result: null, b: null })
      else if (t3 !== undefined && EMPTY_SIDE.test(t3)) { i++; matches.push({ a, result: null, b: null }) }
      else { i++; matches.push({ a, result: t2, b: t3 ?? null }) }
    } else {
      // Two names and no result between them: the page recorded who played but not the score.
      i++
      matches.push({ a, result: null, b: t2 ?? null })
    }
  }
  return { matches, next: i }
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9%+.$]/g, '')

/** Edit distance, capped — only used to forgive a one- or two-character slip between rounds. */
function close(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, x) => [x, ...new Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let x = 1; x <= a.length; x++)
    for (let j = 1; j <= b.length; j++)
      d[x][j] = Math.min(d[x - 1][j] + 1, d[x][j - 1] + 1, d[x - 1][j - 1] + (a[x - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length] <= 2
}

/**
 * Which of the two players won, according to the round that follows.
 *
 * A spelling can drift by a character between rounds — "nichilicious" becomes "nishilicious" — so an
 * exact match is tried across both players first, and only if exactly one of them is a near miss and
 * the other is nowhere in the next round is the near miss accepted. Two candidates means no answer.
 */
function winnerOf(m: Match, nextKeys: Set<string>, notes: string[], where: string): string | null {
  if (!m.b) return m.a
  const ka = key(m.a)
  const kb = key(m.b)
  const ea = nextKeys.has(ka)
  const eb = nextKeys.has(kb)
  if (ea && !eb) return m.a
  if (eb && !ea) return m.b
  if (ea && eb) { notes.push(`${where}: both ${m.a} and ${m.b} appear in the next round`); return null }
  const next = [...nextKeys]
  const na = next.some((n) => close(ka, n))
  const nb = next.some((n) => close(kb, n))
  if (na && !nb) { notes.push(`${where}: read "${m.a}" as the winner on a near-match spelling`); return m.a }
  if (nb && !na) { notes.push(`${where}: read "${m.b}" as the winner on a near-match spelling`); return m.b }
  notes.push(`${where}: neither ${m.a} nor ${m.b} appears in the next round`)
  return null
}

/** The standard 32-draw seed layout, as printed on every capture that carries seed numbers. */
const LAYOUT_32 = [1, 32, 16, 17, 8, 25, 9, 24, 4, 29, 13, 20, 5, 28, 12, 21, 2, 31, 15, 18, 7, 26, 10, 23, 3, 30, 14, 19, 6, 27, 11, 22]

const ROUND_LABELS = ['Round1', 'Round2', 'Quarter Finals', 'Semi Finals', 'Final', 'Winner']

interface Settled { winner: string | null; loser: string | null; result: string | null; bye: boolean }

function convert(paste: string, title: string): { text: string; notes: string[]; summary: string } {
  const tokens = paste.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'))
  const notes: string[] = []

  // Later rounds are strictly triples, so the bracket size follows from how many tokens remain.
  let size = 0
  for (const n of [8, 16, 32, 64]) {
    const r1 = tokens.length - (3 * (n / 2 - 1) + 1)
    if (r1 >= n && r1 <= 1.5 * n) size = n
  }
  if (!size) throw new Error(`cannot fit ${tokens.length} tokens to a bracket`)

  const rounds: Match[][] = []
  let at = 0
  for (let m = size / 2; m >= 1; m /= 2) {
    const r = takeRound(tokens, m, at)
    rounds.push(r.matches)
    at = r.next
  }
  const champion = tokens[at] ?? null
  if (at !== tokens.length - 1) notes.push(`${tokens.length - at - 1} token(s) left over after the champion`)

  /*
   * Resolve every match against the round that follows it, last round first, so the champion decides
   * the final and each earlier round is checked against the winners just settled.
   */
  const settled: Settled[][] = []
  for (let r = 0; r < rounds.length; r++) {
    /*
     * The round that follows names both of its players, and one of them won this match. The final is
     * the exception: nothing follows it but the champion.
     */
    const nextKeys = new Set(
      r === rounds.length - 1
        ? champion ? [key(champion)] : []
        : rounds[r + 1].flatMap((m) => [m.a, m.b]).filter((x): x is string => Boolean(x)).map(key),
    )
    settled.push(rounds[r].map((m, i) => {
      if (!m.b) return { winner: m.a, loser: null, result: null, bye: true }
      const w = winnerOf(m, nextKeys, notes, `round ${r + 1} match ${i + 1}`)
      return { winner: w, loser: w === null ? null : w === m.a ? m.b : m.a, result: m.result, bye: false }
    }))
  }

  // ── Emit ───────────────────────────────────────────────────────────────────────────────────────
  const width = (rounds.length + 1) * 2
  const rows: string[][] = []
  const put = (col: number, v: string) => { const r = new Array(width).fill(' '); r[col] = v; rows.push(r) }

  /*
   * Put the winner's number on the winner's side.
   *
   * The two players stay exactly where the transcription put them, because that order is the bracket's
   * own structure: the upper match of a pair feeds the upper slot of the next one, and moving a name
   * out of its slot severs the link the parser checks each round against. Only the score moves, and
   * only because a race is won by the higher number — so which side that number belongs on follows
   * from who advanced, not from which way round the page happened to print it.
   */
  const oriented = (result: string | null, homeWon: boolean): string => {
    if (!result) return '—'
    const m = SCORE.exec(result)
    if (!m) return result
    const hi = Math.max(Number(m[1]), Number(m[2]))
    const lo = Math.min(Number(m[1]), Number(m[2]))
    return homeWon ? `${hi}-${lo}${m[3] ?? ''}` : `${lo}-${hi}${m[3] ?? ''}`
  }

  const seeds = size === 32 ? LAYOUT_32 : Array.from({ length: size }, (_, i) => i + 1)
  settled[0].forEach((s, i) => {
    put(0, String(seeds[i * 2] ?? ''))
    put(1, rounds[0][i].a)
    put(0, s.bye ? 'bye' : oriented(s.result, s.winner === rounds[0][i].a))
    put(0, String(seeds[i * 2 + 1] ?? ''))
    put(1, s.bye ? 'bye' : (rounds[0][i].b ?? 'bye'))
  })
  for (let r = 1; r < settled.length; r++) {
    const col = 2 * r
    for (let i = 0; i < settled[r].length; i++) {
      const s = settled[r][i]
      put(col, rounds[r][i].a)
      put(col, oriented(s.result, s.winner === rounds[r][i].a))
      put(col, rounds[r][i].b ?? '')
    }
  }
  if (champion) put(2 * settled.length, champion)

  const header = new Array(width).fill('')
  ROUND_LABELS.slice(0, settled.length + 1).forEach((l, i) => { header[i === 0 ? 0 : 2 * i] = l })

  const all = settled.flat()
  const unresolved = all.filter((s) => !s.bye && !s.winner).length
  return {
    text: [
      title,
      'Built from the owner transcription in paste-*.txt. Each winner is the player the next round',
      'contains; the score is oriented so the winner holds the higher number. Seed numbers are the',
      'standard draw layout, not transcribed.',
      header.join('\t'),
      ...rows.map((r) => r.join('\t')),
    ].join('\n') + '\n',
    notes,
    summary: `${size}-draw, ${all.length} matches, ${all.filter((s) => s.bye).length} byes, ${unresolved} unresolved, champion ${champion ?? '—'}`,
  }
}

const ROOT = 'archive/wayback-seasons'
let done = 0
for (const year of readdirSync(ROOT).filter((y) => /^\d{4}$/.test(y)).sort()) {
  if (ONLY_YEAR && year !== ONLY_YEAR) continue
  const dir = join(ROOT, year)
  for (const f of readdirSync(dir).filter((x) => /^paste-\d{4}-s\d+\.txt$/.test(x)).sort()) {
    const num = /-s(\d+)\.txt$/.exec(f)![1]
    const out = join(dir, `${year} s${num}.txt`)
    try {
      const r = convert(readFileSync(join(dir, f), 'utf8'), `${year} SEASON ${num} - DIVISION A Playoff`)
      console.log(`${year} S${num}A: ${r.summary}${existsSync(out) ? '  [overwrites an existing file]' : ''}`)
      for (const n of r.notes) console.log(`    - ${n}`)
      if (APPLY) writeFileSync(out, r.text)
      done++
    } catch (e) {
      console.log(`${year} S${num}A: FAILED — ${(e as Error).message}`)
    }
  }
}
console.log(`\n${done} transcription(s)${APPLY ? ' written' : ' — DRY RUN'}`)
