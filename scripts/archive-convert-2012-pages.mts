/**
 * Convert the 2012-era archived playoff pages into the tab-aligned layout the parser reads.
 *
 * ── A third era ──────────────────────────────────────────────────────────────────────────────────
 * The 2012 pages lay a bracket out as one HTML table per round, each a run of
 * [player, result, player] triples: sixteen in the first table, then eight, four, two, one, and the
 * champion alone in the last. The earlier tab-aligned pages carry the same triples but distributed
 * across columns of a single table.
 *
 * Converting rather than writing a third parser means the bracket goes through exactly the same
 * validation, the same refusal to invent a score, the same bye and forfeit handling as every other
 * Season — and the converted file sits beside the originals where it can be read and checked.
 *
 * ── What these pages do and do not contain ───────────────────────────────────────────────────────
 * Only the pages served as `PlayoffsA.htm` carry a bracket. The ones served as `playoffsA.html`
 * contain thirty-two seed numbers and nothing else: no names, no scores. Those are not converted,
 * because there is nothing in them to convert.
 *
 * Usage: tsx scripts/archive-convert-2012-pages.mts [--apply]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const APPLY = process.argv.includes('--apply')

const ROUND_LABELS = ['Round1', 'Round2', 'Quarter Finals', 'Semi Finals', 'Final', 'Winner']

/** Strip tags and entities from one cell. */
const cellText = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()

interface Extracted {
  seeds: number[]
  /** rounds[r] is a flat list of [a, score, b] for each match of round r+1. */
  rounds: string[][]
  champion: string | null
}

function extract(html: string): Extracted | null {
  const body = html.includes('END WAYBACK TOOLBAR INSERT')
    ? html.split('END WAYBACK TOOLBAR INSERT').slice(-1)[0]
    : html
  const tables = body.match(/<table[\s\S]*?<\/table>/gi) ?? []
  if (tables.length < 3) return null

  const contents = tables.map((t) => {
    const cells = t.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []
    return cells.map(cellText).filter((x) => x.length > 0)
  })

  /*
   * The seed table is whichever one is a run of bare numbers; the round tables are the ones whose
   * length is a multiple of three, in descending size. Identifying them by shape rather than by
   * index keeps this working when a page carries an extra layout table.
   */
  const seedTable = contents.find((c) => c.length >= 16 && c.filter((x) => /^\d{1,2}$/.test(x)).length >= 16)
  const seeds = (seedTable ?? []).filter((x) => /^\d{1,2}$/.test(x)).map(Number)

  const roundTables = contents
    .filter((c) => c !== seedTable && c.length >= 3 && c.length % 3 === 0)
    .sort((a, b) => b.length - a.length)

  if (roundTables.length === 0 || seeds.length < 4) return null

  // The champion sits alone after the Final.
  const champTable = contents.find((c) => c.length === 1 && c !== seedTable)
  return { seeds, rounds: roundTables, champion: champTable ? champTable[0] : null }
}

/**
 * Emit the tab-aligned layout.
 *
 * The parser reads each even column as a run of triples and column 1 as round one's players, so the
 * values only need to land in the right column in the right order. One value per row keeps the
 * output sparse and easy to read against the original.
 */
function toColumnar(x: Extracted, title: string): string {
  const rounds = x.rounds.length
  const width = (rounds + 1) * 2
  const rows: string[][] = []
  const put = (column: number, value: string) => {
    const row = new Array(width).fill(' ')
    row[column] = value
    rows.push(row)
  }

  // Column 0: seed, score, seed per round-one match. Column 1: the two players.
  const r1 = x.rounds[0]
  for (let p = 0; p * 3 < r1.length; p++) {
    const [a, score, b] = [r1[p * 3], r1[p * 3 + 1], r1[p * 3 + 2]]
    put(0, String(x.seeds[p * 2] ?? ''))
    put(1, a)
    put(0, score)
    put(0, String(x.seeds[p * 2 + 1] ?? ''))
    put(1, b)
  }

  // Later rounds: [participant, result, participant] in column 2(r-1).
  for (let r = 2; r <= rounds; r++) {
    const t = x.rounds[r - 1]
    const column = 2 * (r - 1)
    for (let p = 0; p * 3 < t.length; p++) {
      put(column, t[p * 3])
      put(column, t[p * 3 + 1])
      put(column, t[p * 3 + 2])
    }
  }

  if (x.champion) put(2 * rounds, x.champion)

  const header = new Array(width).fill('')
  ROUND_LABELS.slice(0, rounds + 1).forEach((label, i) => { header[i === 0 ? 0 : 2 * i] = label })

  return [
    title,
    'Converted from the archived 2012-era page; one table per round in the original.',
    header.join('\t'),
    ...rows.map((r) => r.join('\t')),
  ].join('\n')
}

const ROOT = 'archive/wayback-seasons'
let converted = 0, skipped = 0
for (const year of ['2012', '2013', '2014']) {
  const dir = join(ROOT, year)
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir).filter((x) => x.startsWith('raw-') && x.endsWith('.html'))) {
    const m = /raw-(\d{4})-s(\d+)\.html/.exec(f)
    if (!m) continue
    const [, yr, num] = m
    const html = readFileSync(join(dir, f), 'utf8')
    const x = extract(html)
    const out = join(dir, `${yr} s${num}.txt`)

    if (!x || x.rounds.length < 2) {
      console.log(`  ${yr} S${num}A: no bracket in this capture — seeds only, nothing to convert`)
      skipped++
      continue
    }
    const scores = x.rounds.flat().filter((v) => /^\d{1,2}\s*-\s*\d{1,2}$/.test(v)).length
    console.log(`  ${yr} S${num}A: ${x.rounds.length} round(s), ${x.seeds.length} seeds, ${scores} score(s), champion ${x.champion ?? '—'}`)
    if (APPLY) writeFileSync(out, toColumnar(x, `${yr} SEASON ${num} - DIVISION A Playoff`) + '\n')
    converted++
  }
}

console.log(`\n${converted} page(s) with a bracket, ${skipped} with seeds only${APPLY ? ' — written' : ' — DRY RUN'}`)
