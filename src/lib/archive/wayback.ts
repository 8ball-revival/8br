/**
 * Read the archived playoff bracket tables captured from the Wayback Machine.
 *
 * ── What these files are ─────────────────────────────────────────────────────────────────────────
 * The season manifest records who played in a playoff, the champion and the runner-up, but no
 * per-match score for any Season. The archived bracket pages do carry the scores, and they are the
 * only surviving record of them, so this is the difference between a reconstructed playoff that
 * shows who took part and one that shows what happened.
 *
 * ── The two eras, and why only one is parsed here ────────────────────────────────────────────────
 * The 2005–2007 S2 pages lay the bracket out with "(A1) handle" seeds and print the match FORMAT
 * ("Race to 7 win by 2") where a later page prints the score. They contain no numeric result at all,
 * so no parser could recover one; those Seasons are placement evidence and nothing more. From
 * 2007 S3 the pages switch to the tab-aligned layout this module reads.
 *
 * ── How the tab-aligned layout encodes a bracket ─────────────────────────────────────────────────
 * The table is column-major: the round a cell belongs to is decided by which column it is in, not by
 * its position down the page.
 *
 *     col 0        col 1        col 2         col 4          col 6
 *     seed / R1 score           R1 winner     R2 winner      R3 winner
 *                  R1 player    / R2 score    / R3 score     / R4 score
 *
 * So for round r the score lives in column 2(r-1) and the winner's name in column 2r, with round 1's
 * players a special case in column 1 alongside their seeds in column 0. A column therefore holds two
 * different kinds of thing, told apart by shape: "7-4" is a result, anything else is a name.
 *
 * ── What is deliberately not inferred ────────────────────────────────────────────────────────────
 * A name appearing in a later column is the bracket carrying somebody forward, not evidence that a
 * match was played — a bye advances the same way a win does. Where the score cell holds the format
 * ("RT7 Win By 2") instead of a result, the match is recorded as having no score rather than being
 * given one. And a bye is never turned into a win: the pages print "7-0" beside several of them,
 * which would otherwise fabricate a whitewash against a player who never turned up.
 */
import { stripSourceNote } from './manifest'

export type WaybackFormat = 'columnar' | 'era-2005' | 'unrecognised'

export interface WaybackCell {
  /** 1-based line in the source file, so any parsed value can be traced back to what it came from. */
  line: number
  column: number
  raw: string
}

export interface WaybackPlayer {
  seed: number | null
  rawHandle: string
  normalizedHandle: string
  bye: boolean
  source: WaybackCell | null
}

export interface WaybackMatch {
  /** 1-based: round 1 is the opening round of the bracket as the page draws it. */
  round: number
  roundLabel: string
  /** 0-based position within the round, top to bottom — the bracket's own ordering. */
  position: number
  home: WaybackPlayer | null
  away: WaybackPlayer | null
  scoreHome: number | null
  scoreAway: number | null
  /** Exactly what the score cell held, including "RT7 Win By 2" and the like. */
  rawScore: string | null
  winnerHandle: string | null
  /** Where this match's winner is carried to, or null for the Final. */
  advancesTo: { round: number; position: number; side: 'home' | 'away' } | null
  /** A walkover: one side is the page's literal "bye". No game was played. */
  bye: boolean
  /** What the result cell says: a score, a forfeit, a disqualification, or nothing usable. */
  outcome: MatchOutcome
  /** For a forfeit, the printed side that gave it up. */
  forfeitedBy: 'home' | 'away' | null
  /**
   * Whether this match on its own is supported by the page.
   *
   * Set during validation. A sibling match with no score does not make this one unprovable: the
   * page names both of this match's participants either way, so what matters is whether THIS
   * result is written down and agrees with who was carried forward.
   */
  proven: boolean
  source: WaybackCell | null
}

export type ValidationCategory = 'full' | 'partial' | 'placement-only' | 'contradictory' | 'unusable'

export interface WaybackValidation {
  category: ValidationCategory
  /** The first match that cannot be supported, and why. Everything before it is proven. */
  firstUnsupported: { round: number; position: number; reason: string } | null
  problems: string[]
  /** How far down the bracket the results are proven, 0 when none are. */
  provenThroughRound: number
}

export interface WaybackBracket {
  sourceFile: string
  format: WaybackFormat
  competitionYear: number
  seasonNumber: number
  /** These captures are Division A only; nothing here may ever be applied to Division B. */
  division: 'A'
  bracketSize: number
  rounds: string[]
  matches: WaybackMatch[]
  champion: string | null
  runnerUp: string | null
  validation: WaybackValidation
}

const SCORE = /^(\d{1,3})\s*-\s*(\d{1,3})$/

/**
 * What a result cell actually says.
 *
 * The pages record more than scores. A match can be forfeited, walked over or disqualified, and each
 * is a different fact about what happened — collapsing them into "no score" loses the forfeit that
 * really did decide a match, while treating them all as forfeits would invent a walkover from a
 * disqualification. The side is taken from where the marker is printed: "0-FF" is the away player
 * forfeiting, "FF-7" the home one.
 */
const FF_AWAY = /^\s*(\d{0,3})\s*-\s*FF'?d?\s*$/i
const FF_HOME = /^\s*FF'?d?\s*-\s*(\d{0,3})\s*$/i
/**
 * Outcomes that award a match rather than score it.
 *
 * A disqualification, a forfeit, a walkover and a match the page never scored are different facts,
 * and the parser keeps them apart so the reports can say which happened. They are recorded the same
 * way, though — the opponent advances with no games either side — so everything downstream asks this
 * rather than naming one outcome and quietly dropping the others.
 *
 * The last of those is the owner's decision: where a page prints the match FORMAT where a score
 * belongs, or prints nothing at all, the bracket still says who won, and that is recorded as the
 * loser giving the match up. It is not what happened — the match was played and the score is lost —
 * but it keeps the winner, the advancement and the title, and no invented score is written.
 */
export const isForfeitLike = (o: MatchOutcome): boolean =>
  o === 'forfeit' || o === 'disqualification' || o === 'walkover' || o === 'missing'

/**
 * A cell that looks like it was meant to be a score.
 *
 * `missing` covers both an empty cell and one holding something this parser does not understand, and
 * those must not be treated alike. If a cell holds two numbers either side of a dash, it was almost
 * certainly a real result in a spelling not yet handled, and turning it into a forfeit would replace
 * a match somebody played with one nobody did. Such a cell stays unproven and is reported, so the
 * spelling can be added rather than papered over.
 */
export const looksLikeAScore = (raw: string | null | undefined): boolean =>
  Boolean(raw && /\d\s*[-–—:]\s*\d/.test(raw))

const DQ_ANY = /DQ/i
const WALKOVER = /W\s*\/?\s*O/i

export type MatchOutcome =
  | 'numeric'
  | 'bye'
  | 'forfeit'
  | 'disqualification'
  | 'walkover'
  | 'missing'

export interface ParsedOutcome {
  outcome: MatchOutcome
  scoreHome: number | null
  scoreAway: number | null
  /** Which printed side gave the match up, when the source says. */
  forfeitedBy: 'home' | 'away' | null
}

/** Read one result cell. The raw text is always kept by the caller. */
export function readOutcome(raw: string | null, isBye: boolean): ParsedOutcome {
  if (isBye) return { outcome: 'bye', scoreHome: null, scoreAway: null, forfeitedBy: null }
  if (!raw || !raw.trim()) return { outcome: 'missing', scoreHome: null, scoreAway: null, forfeitedBy: null }

  const t = raw.trim()
  const numeric = SCORE.exec(t)
  if (numeric) {
    return { outcome: 'numeric', scoreHome: Number(numeric[1]), scoreAway: Number(numeric[2]), forfeitedBy: null }
  }

  /*
   * Disqualification is checked before forfeit.
   *
   * One cell reads "DQ'd-FF'd", and a disqualification that also involved a forfeit is still a
   * disqualification — which the owner has not defined a record for, so it stays unimported rather
   * than being quietly downgraded to something the system already knows how to write.
   */
  if (DQ_ANY.test(t)) return { outcome: 'disqualification', scoreHome: null, scoreAway: null, forfeitedBy: null }

  /*
   * A score annotated as a forfeit: "0-3 (FF)".
   *
   * Different from "0-FF", where the marker occupies a score position and names the side directly.
   * Here both numbers are printed and the annotation says the match was conceded, so the forfeiter
   * is the side that lost. No games are recorded either way — the numbers describe a concession,
   * not frames anybody played.
   */
  const annotated = /^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*[([]\s*FF['’]?d?\s*[)\]]\s*$/i.exec(t)
  if (annotated) {
    const a = Number(annotated[1]), b = Number(annotated[2])
    if (a === b) return { outcome: 'missing', scoreHome: null, scoreAway: null, forfeitedBy: null }
    return { outcome: 'forfeit', scoreHome: null, scoreAway: null, forfeitedBy: a < b ? 'home' : 'away' }
  }

  const away = FF_AWAY.exec(t)
  if (away) return { outcome: 'forfeit', scoreHome: null, scoreAway: null, forfeitedBy: 'away' }
  const home = FF_HOME.exec(t)
  if (home) return { outcome: 'forfeit', scoreHome: null, scoreAway: null, forfeitedBy: 'home' }

  // A bare "FF", "Forfeit" or a walkover says a match was given up, without saying by whom.
  if (WALKOVER.test(t) || /^(?:FF['’]?d?|Forfeit(?:ed)?)$/i.test(t)) {
    return { outcome: 'walkover', scoreHome: null, scoreAway: null, forfeitedBy: null }
  }

  return { outcome: 'missing', scoreHome: null, scoreAway: null, forfeitedBy: null }
}
const BYE = /^byes?$/i

/** Empty in this source means a cell the table did not fill; it never means a bye. */
const blank = (v: string | undefined) => !v || v.trim() === '' || v.trim() === ' '

/**
 * Reduce a printed handle to the identity it names.
 *
 * `stripSourceNote` already removes the wildcard marker and the decorative middle dot the bracket
 * pages append. Underscores, dots and digits are part of these handles and are left alone —
 * `l1_stephen_1` and `x_majik.shots_x` are how those people are spelled.
 */
export function normaliseHandle(raw: string): string {
  return stripSourceNote(
    raw
      .replace(/ /g, ' ')
      /*
       * The decoration the bracket pages append to some handles.
       *
       * In the captured files it survives as a lone 0xC2 lead byte, which reads back as Â or
       * as the replacement character depending on how the file is decoded. It is a printing
       * flourish rather than part of a name: the identities are the_pool_professor and t_an_may.
       */
      .replace(/[Â·•®�]+$/, '')
      .trim(),
  ).trim()
}

export function detectFormat(text: string): WaybackFormat {
  const lines = text.split(/\r?\n/)
  if (lines.some((l) => /^Round\s*1\t/i.test(l))) return 'columnar'
  if (lines.some((l) => /^ROUND\s*1\s*:/i.test(l))) return 'era-2005'
  return 'unrecognised'
}

/** Year and season number from the file name, e.g. "2009 s4.txt". */
export function identifyFile(path: string): { competitionYear: number; seasonNumber: number } | null {
  const m = /(\d{4})[^\d]*s\s*(\d+)/i.exec(path.replace(/\\/g, '/').split('/').pop() ?? '')
  if (!m) return null
  return { competitionYear: Number(m[1]), seasonNumber: Number(m[2]) }
}

interface ColumnCell { line: number; value: string }

/**
 * Every non-empty cell of a column, in the order the page prints them.
 *
 * The bracket's meaning is carried by that order: the first name in the round-2 column won the first
 * round-1 match, the second won the second, and so on.
 */
function columnCells(rows: string[][], column: number, fromLine: number): ColumnCell[] {
  const out: ColumnCell[] = []
  for (let i = fromLine; i < rows.length; i++) {
    const v = rows[i][column]
    if (!blank(v)) out.push({ line: i + 1, value: v.trim() })
  }
  return out
}

export function parseColumnarBracket(text: string, sourceFile: string): WaybackBracket {
  const id = identifyFile(sourceFile)
  const rows = text.split(/\r?\n/).map((l) => l.split('\t'))

  const headerIndex = rows.findIndex((r) => /^Round\s*1$/i.test((r[0] ?? '').trim()))
  const header = headerIndex >= 0 ? rows[headerIndex] : []
  const roundLabels: { column: number; label: string }[] = []
  header.forEach((cell, column) => {
    if (!blank(cell)) roundLabels.push({ column, label: cell.trim() })
  })

  const problems: string[] = []
  if (headerIndex < 0) problems.push('no round header row')

  /*
   * The body starts after the deadline block.
   *
   * Each round's header is followed by two or three lines of deadline text that also contain tabs,
   * so the body is taken to begin at the first row whose first cell is a bare seed number.
   */
  const bodyStart = rows.findIndex((r, i) => i > headerIndex && /^\d{1,3}$/.test((r[0] ?? '').trim()))
  if (bodyStart < 0) problems.push('no seeded round-1 rows')

  /*
   * Every even column is a run of triples: participant, result, participant.
   *
   * Column 0 gives round 1 its seeds and its scores; column 2 gives round 1's winners and round 2's
   * scores; column 4 gives round 2's winners and round 3's scores, and so on. Reading each column as
   * [a, score, b] repeated is what makes the layout unambiguous — an earlier attempt separated the
   * two kinds by shape instead, and a match whose result cell reads "RT7 Win By 2" rather than a
   * score was counted as a name, shifting every subsequent row in that column and inventing
   * advancements that the page never printed.
   */
  const triples = (column: number): (ColumnCell | undefined)[][] => {
    const cells = bodyStart < 0 ? [] : columnCells(rows, column, bodyStart)
    const out: (ColumnCell | undefined)[][] = []
    for (let i = 0; i < cells.length; i += 3) out.push([cells[i], cells[i + 1], cells[i + 2]])
    return out
  }

  // ── Round 1: seeds and scores in column 0, the players themselves in column 1 ─────────────────
  const seedTriples = triples(0)
  const nameCells = bodyStart < 0 ? [] : columnCells(rows, 1, bodyStart)

  const slots: WaybackPlayer[] = nameCells.map((c, i) => {
    const t = seedTriples[Math.floor(i / 2)]
    const seedCell = i % 2 === 0 ? t?.[0] : t?.[2]
    const seed = seedCell && /^\d{1,3}$/.test(seedCell.value) ? Number(seedCell.value) : null
    return {
      seed,
      rawHandle: c.value,
      normalizedHandle: normaliseHandle(c.value),
      bye: BYE.test(c.value.trim()),
      source: { line: c.line, column: 1, raw: c.value },
    }
  })

  const bracketSize = slots.length
  const roundCount = bracketSize > 0 ? Math.log2(bracketSize) : 0
  if (bracketSize > 0 && !Number.isInteger(roundCount)) {
    problems.push(`round 1 holds ${bracketSize} places, which is not a power of two`)
  }

  const matches: WaybackMatch[] = []
  const totalRounds = Number.isInteger(roundCount) ? roundCount : 0

  for (let r = 1; r <= totalRounds; r++) {
    const column = 2 * (r - 1)
    const rowsOfRound = triples(column)
    const expected = bracketSize / 2 ** r

    for (let p = 0; p < expected; p++) {
      const t = rowsOfRound[p]
      const scoreCell = t?.[1]

      /*
       * Round 1's players come from the name column; every later round's come from the two
       * participant cells of this column, which are the previous round's winners as the page
       * carried them forward.
       */
      const home = r === 1
        ? slots[p * 2] ?? null
        : t?.[0] ? playerFromCell(t[0]!, column) : null
      const away = r === 1
        ? slots[p * 2 + 1] ?? null
        : t?.[2] ? playerFromCell(t[2]!, column) : null

      const isBye = Boolean(home?.bye || away?.bye)
      const read = readOutcome(scoreCell?.value ?? null, isBye)

      matches.push({
        round: r,
        roundLabel: roundLabels[r - 1]?.label ?? `Round ${r}`,
        position: p,
        home,
        away,
        // A bye is a walkover. Several pages print "7-0" beside one; recording it would manufacture
        // a whitewash against somebody who never played.
        scoreHome: read.scoreHome,
        scoreAway: read.scoreAway,
        outcome: read.outcome,
        forfeitedBy: read.forfeitedBy,
        rawScore: scoreCell?.value ?? null,
        winnerHandle: null,
        advancesTo: r < totalRounds
          ? { round: r + 1, position: Math.floor(p / 2), side: p % 2 === 0 ? 'home' : 'away' }
          : null,
        bye: isBye,
        proven: false,
        source: scoreCell ? { line: scoreCell.line, column, raw: scoreCell.value } : null,
      })
    }
  }

  /*
   * Who the page carried forward, read from the next round rather than guessed.
   *
   * The winner of a match is whichever participant the following round seats in the position this
   * match feeds. Taking it from the source rather than deriving it from the score is what lets the
   * validation compare the two and notice when they disagree.
   */
  for (const m of matches) {
    if (!m.advancesTo) continue
    const next = matches.find((x) => x.round === m.advancesTo!.round && x.position === m.advancesTo!.position)
    const seat = m.advancesTo.side === 'home' ? next?.home : next?.away
    m.winnerHandle = seat?.normalizedHandle ?? null
  }
  const finalRoundMatch = matches.find((m) => m.round === totalRounds && m.position === 0)

  // The champion column sits one beyond the Final's winner column.
  const championColumn = 2 * totalRounds
  const championCells = bodyStart < 0 || totalRounds === 0
    ? []
    : columnCells(rows, championColumn, bodyStart).filter((c) => !SCORE.test(c.value))
  const champion = championCells[0] ? normaliseHandle(championCells[0].value) : null

  const finalMatch = finalRoundMatch ?? null
  const runnerUp = finalMatch && champion
    ? [finalMatch.home?.normalizedHandle, finalMatch.away?.normalizedHandle]
        .find((h) => h && h.toLowerCase() !== champion.toLowerCase()) ?? null
    : null

  return {
    sourceFile,
    format: 'columnar',
    competitionYear: id?.competitionYear ?? 0,
    seasonNumber: id?.seasonNumber ?? 0,
    division: 'A',
    bracketSize,
    rounds: roundLabels.map((r) => r.label),
    matches,
    champion,
    runnerUp,
    validation: validateBracket({ matches, bracketSize, champion, runnerUp, totalRounds, problems }),
  }
}

function playerFromCell(cell: ColumnCell, column: number): WaybackPlayer {
  return {
    seed: null,
    rawHandle: cell.value,
    normalizedHandle: normaliseHandle(cell.value),
    bye: BYE.test(cell.value.trim()),
    source: { line: cell.line, column, raw: cell.value },
  }
}

/**
 * Decide how much of a parsed bracket can be trusted.
 *
 * The categories are about evidence, not tidiness. `full` means the chain holds from the opening
 * round to a Final that produces the champion the page names. `partial` means it holds for a while
 * and then stops, and the point where it stops is reported so the import can go exactly that far and
 * no further. `contradictory` means the page disagrees with itself, which is never resolved by
 * preferring one half of it.
 */
export function validateBracket(input: {
  matches: WaybackMatch[]
  bracketSize: number
  champion: string | null
  runnerUp: string | null
  totalRounds: number
  problems: string[]
}): WaybackValidation {
  const { matches, bracketSize, champion, totalRounds } = input
  const problems = [...input.problems]
  let firstUnsupported: WaybackValidation['firstUnsupported'] = null
  let provenThroughRound = 0

  const note = (round: number, position: number, reason: string) => {
    problems.push(`round ${round} match ${position + 1}: ${reason}`)
    if (!firstUnsupported) firstUnsupported = { round, position, reason }
  }

  if (bracketSize === 0) {
    return { category: 'unusable', firstUnsupported: null, problems: [...problems, 'no bracket found'], provenThroughRound: 0 }
  }

  const eq = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase())

  for (let r = 1; r <= totalRounds; r++) {
    const inRound = matches.filter((m) => m.round === r).sort((a, b) => a.position - b.position)
    let roundProven = inRound.length > 0

    for (const m of inRound) {
      const sides = [m.home, m.away].filter(Boolean) as WaybackPlayer[]

      if (m.bye) {
        // A walkover only needs the surviving player, and must carry no score.
        const survivor = sides.find((s) => !s.bye)
        if (!survivor) { note(r, m.position, 'a bye with nobody to advance'); roundProven = false; continue }
        m.proven = true
        if (m.scoreHome !== null || m.scoreAway !== null) {
          note(r, m.position, 'a bye carrying a score'); roundProven = false; continue
        }
        if (m.winnerHandle && !eq(m.winnerHandle, survivor.normalizedHandle)) {
          note(r, m.position, `bye advances ${survivor.normalizedHandle} but the page carries ${m.winnerHandle}`)
          roundProven = false
        }
        continue
      }

      if (sides.length < 2) { note(r, m.position, 'fewer than two participants'); roundProven = false; continue }

      /*
       * A forfeit is a result, and by the owner's decision so is a disqualification: the match was
       * awarded, the winner advances, and no games are recorded for either player.
       *
       * "0-FF" names the side that gave the match up. A bare "DQ" does not — but the bracket does,
       * by carrying one of the two players into the next round and leaving the other behind. So the
       * advancing player supplies what the cell omits, and where a side IS printed it is still read
       * from the cell and checked against the advancement, as before. Neither is guessed at: a
       * disqualification the bracket does not resolve stays unproven.
       */
      if (isForfeitLike(m.outcome)) {
        const named = m.outcome === 'disqualification' ? 'a disqualification'
          : m.outcome === 'walkover' ? 'a walkover'
          : m.outcome === 'missing' ? (m.rawScore?.trim() ? `an unreadable result ("${m.rawScore}")` : 'no result at all')
          : 'a forfeit'
        if (m.outcome === 'missing' && looksLikeAScore(m.rawScore)) {
          note(r, m.position, `a result this parser cannot read, but which looks like a score — the page prints "${m.rawScore}"`)
          roundProven = false; continue
        }
        const side: 'home' | 'away' | null =
          m.forfeitedBy ??
          (m.winnerHandle && m.home && m.away
            ? eq(m.winnerHandle, m.home.normalizedHandle) ? 'away'
              : eq(m.winnerHandle, m.away.normalizedHandle) ? 'home'
              : null
            : null)
        if (!side) {
          note(r, m.position, `${named} naming no side, on a match the bracket does not resolve either — the page prints "${m.rawScore}"`)
          roundProven = false; continue
        }
        const winner = side === 'home' ? m.away : m.home
        if (!winner) { note(r, m.position, `${named} with nobody to advance`); roundProven = false; continue }
        if (m.winnerHandle && !eq(m.winnerHandle, winner.normalizedHandle)) {
          note(r, m.position, `${named} gives ${winner.normalizedHandle} but the page advances ${m.winnerHandle}`)
          roundProven = false; continue
        }
        m.forfeitedBy = side
        m.proven = true
        continue
      }
      if (m.scoreHome === null || m.scoreAway === null) {
        note(r, m.position, m.rawScore ? `no numeric result — the page prints "${m.rawScore}"` : 'no result recorded')
        roundProven = false
        continue
      }
      if (m.scoreHome === m.scoreAway) { note(r, m.position, 'a drawn score cannot name a winner'); roundProven = false; continue }

      const derived = m.scoreHome > m.scoreAway ? m.home : m.away
      if (!derived) { note(r, m.position, 'the winning side has no player'); roundProven = false; continue }
      if (m.winnerHandle && !eq(m.winnerHandle, derived.normalizedHandle)) {
        note(r, m.position, `the score gives ${derived.normalizedHandle} but the page advances ${m.winnerHandle}`)
        roundProven = false
        continue
      }

      // The winner must be the player the next round actually receives.
      if (m.advancesTo) {
        const next = matches.find((x) => x.round === m.advancesTo!.round && x.position === m.advancesTo!.position)
        const seat = m.advancesTo.side === 'home' ? next?.home : next?.away
        if (next && seat && !eq(seat.normalizedHandle, derived.normalizedHandle)) {
          note(r, m.position, `winner ${derived.normalizedHandle} is not the player carried into round ${m.advancesTo.round}`)
          roundProven = false
          continue
        }
      }
      m.proven = true
    }

    /*
     * Every round is examined, but only an unbroken run from round 1 counts as proven depth.
     *
     * Breaking out of the loop at the first imperfect round left later matches unexamined and so
     * unimportable, even where the page records them perfectly well — 14 of 31 matches instead of
     * 28. A missing score in one match says nothing about a different match whose participants the
     * page names and whose result it prints.
     */
    if (roundProven && provenThroughRound === r - 1) provenThroughRound = r
  }

  // Nobody may appear in two places in the same round.
  for (let r = 1; r <= totalRounds; r++) {
    const seen = new Map<string, number>()
    for (const m of matches.filter((x) => x.round === r)) {
      for (const s of [m.home, m.away]) {
        if (!s || s.bye) continue
        const k = s.normalizedHandle.toLowerCase()
        seen.set(k, (seen.get(k) ?? 0) + 1)
      }
    }
    for (const [handle, n] of seen) {
      if (n > 1) problems.push(`round ${r}: ${handle} occupies ${n} positions`)
    }
  }

  const finalMatch = matches.find((m) => m.round === totalRounds && m.position === 0)
  const championAgrees = Boolean(
    champion && finalMatch && finalMatch.scoreHome !== null && finalMatch.scoreAway !== null &&
    eq(champion, (finalMatch.scoreHome > finalMatch.scoreAway ? finalMatch.home : finalMatch.away)?.normalizedHandle),
  )
  if (champion && finalMatch && finalMatch.scoreHome !== null && !championAgrees) {
    problems.push(`the Final's score does not produce the champion the page names (${champion})`)
    return { category: 'contradictory', firstUnsupported, problems, provenThroughRound: Math.max(0, totalRounds - 1) }
  }
  if (problems.some((p) => /occupies \d+ positions/.test(p))) {
    return { category: 'contradictory', firstUnsupported, problems, provenThroughRound }
  }

  const anyScore = matches.some((m) => m.scoreHome !== null)
  if (!anyScore) {
    return { category: 'placement-only', firstUnsupported, problems, provenThroughRound: 0 }
  }
  if (provenThroughRound === totalRounds && championAgrees) {
    return { category: 'full', firstUnsupported: null, problems, provenThroughRound }
  }
  return { category: 'partial', firstUnsupported, problems, provenThroughRound }
}

export function parseWayback(text: string, sourceFile: string): WaybackBracket {
  const format = detectFormat(text)
  if (format === 'columnar') return parseColumnarBracket(text, sourceFile)

  const id = identifyFile(sourceFile)
  return {
    sourceFile,
    format,
    competitionYear: id?.competitionYear ?? 0,
    seasonNumber: id?.seasonNumber ?? 0,
    division: 'A',
    bracketSize: 0,
    rounds: [],
    matches: [],
    champion: null,
    runnerUp: null,
    validation: {
      category: format === 'era-2005' ? 'placement-only' : 'unusable',
      firstUnsupported: null,
      problems: [format === 'era-2005'
        ? 'the 2005-era pages print the match format where a later page prints the score, so they record no result'
        : 'the page does not match any known bracket layout'],
      provenThroughRound: 0,
    },
  }
}
