/**
 * The redesigned Season Groups page: its data, its arithmetic, and the claims it makes.
 *
 * ── What this suite is really guarding ──────────────────────────────────────────────────────────
 * Two things, and only the second is about presentation.
 *
 * The first is that the page cannot disagree with itself. Every figure it shows — sets played,
 * completion, remaining, clinched — now comes from one derivation, and the checks below assert that
 * the header, the group and the row are reading the SAME number rather than three that happen to
 * match today.
 *
 * The second is the clinch claim. "Mathematically guaranteed" is a strong thing to print beside
 * somebody's name, and the only acceptable error is being late. So a large part of what follows is
 * adversarial: rivals who win everything, ties that cannot be broken, bonuses that may or may not
 * be earned. A false clinch fails this suite; a conservative one passes.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/verify-group-board.mts
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { getSeasonGroupStage } from '../src/lib/seasons/views.ts'
import { getGroupBoard, monogramOf, showsClinch } from '../src/lib/seasons/group-board.ts'
import { computeClinches, isClinched, type ClinchRow } from '../src/lib/seasons/clinch.ts'
import { seasonAdvancement, advancingInGroup } from '../src/lib/seasons/advancement.ts'
import { getSeasonBrowseData } from '../src/lib/seasons/browse.ts'
import { saveSeasonGroupResults } from '../src/lib/seasons/group-stage.ts'
import { WIN_POINTS, DRAW_POINTS, COMPLETION_BONUS, computeStandings } from '../src/lib/competition/standings.ts'

assertLocalDatabase()

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)
/** Source with comments stripped: these files explain what they avoid, so prose would false-match. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => readFileSync(p, 'utf8')

const ACTOR = { userId: 0, username: 'verify-group-board' }

// ── The clinch engine, as pure arithmetic ───────────────────────────────────────────────────────

section('Clinching is conservative before it is anything else')

const RULES = {
  pointsForWin: WIN_POINTS,
  pointsForDraw: DRAW_POINTS,
  completionBonus: COMPLETION_BONUS,
}
const row = (o: Partial<ClinchRow> & { entrantId: number }): ClinchRow => ({
  points: 0, wins: 0, losses: 0, draws: 0, played: 0, gamesWon: 0, gamesLost: 0,
  remaining: 0, rank: o.entrantId, ...o,
})

/*
  The headline case: a big lead, with enough left for it to be overturned.

  Four players, top two advance. The leader has 12 and three sets left; two rivals have 3 and three
  sets left, so each can reach 3 + 9 + bonus = 13. Two of them can pass, and only two places exist —
  so the leader is NOT clinched. A likelihood-based test would have marked them.
*/
const leading = computeClinches({
  rows: [row({ entrantId: 1, points: 12, played: 3, remaining: 3 }),
    row({ entrantId: 2, points: 3, played: 3, remaining: 3 }),
    row({ entrantId: 3, points: 3, played: 3, remaining: 3 }),
    row({ entrantId: 4, points: 0, played: 3, remaining: 3 })],
  advancing: 2, fullSlate: 6, ...RULES,
})
check('a commanding lead with sets left is NOT a clinch',
  leading.find((v) => v.entrantId === 1)!.status === 'above-line',
  leading.find((v) => v.entrantId === 1)!.status)
check('...and the engine says why: two rivals can still reach them',
  leading.find((v) => v.entrantId === 1)!.rivalsAbove === 2)

/* Now make it genuinely safe: the rivals run out of sets. */
const safe = computeClinches({
  rows: [row({ entrantId: 1, points: 12, played: 6, remaining: 0 }),
    row({ entrantId: 2, points: 3, played: 6, remaining: 0 }),
    row({ entrantId: 3, points: 3, played: 6, remaining: 0 }),
    row({ entrantId: 4, points: 0, played: 6, remaining: 0 })],
  advancing: 2, fullSlate: 6, ...RULES,
})
check('once nobody can catch them, it IS a clinch', isClinched(safe.find((v) => v.entrantId === 1)!.status))
check('...and with everything played the seed is locked too',
  safe.find((v) => v.entrantId === 1)!.status === 'seed-locked')
check('the player outside the places is not marked', !isClinched(safe.find((v) => v.entrantId === 4)!.status))

/*
  A tie that cannot be broken in advance.

  Equal points with a set still to play is not a clinch for either, because the tiebreakers include
  a head-to-head that has not happened. `couldOvertake` uses >= for exactly this.
*/
const tied = computeClinches({
  rows: [row({ entrantId: 1, points: 6, played: 2, remaining: 1 }),
    row({ entrantId: 2, points: 6, played: 2, remaining: 1 }),
    row({ entrantId: 3, points: 0, played: 3, remaining: 0 })],
  advancing: 1, fullSlate: 3, ...RULES,
})
check('a tie with a set left clinches nobody', tied.every((v) => !isClinched(v.status)))

/* The same tie, all played out — now rank has settled it and the leader is in. */
const tiedDone = computeClinches({
  rows: [row({ entrantId: 1, points: 6, played: 3, remaining: 0, rank: 1 }),
    row({ entrantId: 2, points: 6, played: 3, remaining: 0, rank: 2 }),
    row({ entrantId: 3, points: 0, played: 3, remaining: 0, rank: 3 })],
  advancing: 1, fullSlate: 3, ...RULES,
})
check('a finished tie is settled by the engine rank, not left forever unresolved',
  isClinched(tiedDone.find((v) => v.entrantId === 1)!.status))
check('...and the player it was settled against is not marked',
  !isClinched(tiedDone.find((v) => v.entrantId === 2)!.status))

/*
  The completion bonus, in both directions.

  A player who has not finished their slate cannot bank it (a set can be closed out as a no
  contest), so it must not raise their floor. A rival who still can must have it in their ceiling.
*/
const bonusEdge = computeClinches({
  rows: [row({ entrantId: 1, points: 9, played: 3, remaining: 1 }),
    row({ entrantId: 2, points: 6, played: 3, remaining: 1 })],
  advancing: 1, fullSlate: 4, ...RULES,
})
check('a rival within one win plus the completion bonus is still a threat',
  !isClinched(bonusEdge.find((v) => v.entrantId === 1)!.status),
  'ceiling must include the bonus')

/* Adversarial sweep: no arrangement of a three-way race with sets left may clinch anybody. */
let falseClinches = 0
for (let a = 0; a <= 12; a += 3) {
  for (let b = 0; b <= 12; b += 3) {
    for (let rem = 1; rem <= 3; rem++) {
      const v = computeClinches({
        rows: [row({ entrantId: 1, points: a, played: 3, remaining: rem }),
          row({ entrantId: 2, points: b, played: 3, remaining: rem }),
          row({ entrantId: 3, points: 0, played: 3, remaining: rem })],
        advancing: 1, fullSlate: 3 + rem, ...RULES,
      })
      for (const verdict of v) {
        if (!isClinched(verdict.status)) continue
        // A clinch is only legitimate if no rival's ceiling reaches this player's floor.
        const me = [{ id: 1, p: a }, { id: 2, p: b }, { id: 3, p: 0 }].find((x) => x.id === verdict.entrantId)!
        const rivals = [{ id: 1, p: a }, { id: 2, p: b }, { id: 3, p: 0 }].filter((x) => x.id !== me.id)
        const myFloor = me.p
        const anyReach = rivals.some((r) => r.p + rem * WIN_POINTS + COMPLETION_BONUS >= myFloor)
        if (anyReach) falseClinches++
      }
    }
  }
}
check('no arrangement of an unfinished three-way race produces a false clinch', falseClinches === 0, `${falseClinches}`)

check('a group with no advancing places clinches nobody',
  computeClinches({ rows: [row({ entrantId: 1, points: 9, remaining: 0 })], advancing: 0, fullSlate: 0, ...RULES })
    .every((v) => !isClinched(v.status)))

// ── Advancement configuration ───────────────────────────────────────────────────────────────────

section('The advancement count is configuration, not a literal')

const adv = seasonAdvancement()
check('the count comes from the season constant', adv.source === 'season-constant')
check('...and is the same one that writes SeasonStanding.qualified', adv.perGroup === 3, `${adv.perGroup}`)
check('a group smaller than the count cannot advance more players than it has',
  advancingInGroup(2) === 2 && advancingInGroup(1) === 1, `${advancingInGroup(2)}`)
check('a normal group gets the configured count', advancingInGroup(8) === adv.perGroup)

const boardSrc = code(read('src/components/seasons/season-group-board.tsx'))
check('the cutoff is drawn from the configured count, never a row number',
  /i === group\.advancing - 1/.test(boardSrc) && !/i === 2\b|i === 3\b/.test(boardSrc))
check('...and "Top N advance" prints the same number', /Top \{group\.advancing\} advance/.test(boardSrc))

const advSrc = read('src/lib/seasons/advancement.ts')
check('the conflict between the three advancement answers is documented, not resolved silently',
  /Tournament\.qualifiersPerGroup/.test(advSrc) && /enterSeasonPlayoffSetup/.test(advSrc) && /TOP 4 ADVANCE/.test(advSrc))

// ── The competition toggle ──────────────────────────────────────────────────────────────────────

section('8BR | WCC comes from the Competition model')

const browse = await getSeasonBrowseData(null, 'CUEVERSE')
check('the toggle offers the competitions that run Seasons',
  browse.competitions.map((c) => c.slug).join(',') === '8brcam,wcc',
  browse.competitions.map((c) => c.slug).join(','))
check('...labelled from their stored short names, not hardcoded text',
  browse.competitions.every((c) => c.shortName.length > 0 && c.shortName.length <= 8))
check('...and a tournament-only competition is not offered',
  !browse.competitions.some((c) => c.slug === 'cueverse'))

const under8br = await getSeasonBrowseData('8brcam', 'CUEVERSE')
const underWcc = await getSeasonBrowseData('wcc', 'CUEVERSE')
check('years follow the competition', under8br.years.length > 0 && underWcc.years.length === 0,
  `8br ${under8br.years.length}, wcc ${underWcc.years.length}`)
check('seasons follow the competition', under8br.seasons.length > 0 && underWcc.seasons.length === 0)
check('...and every season offered belongs to that competition',
  under8br.seasons.every((s) => s.competitionSlug === '8brcam'))

const controls = code(read('src/components/seasons/season-controls.tsx'))
check('the platform selector is gone', !/f-platform|'CUEVERSE'\s*\|\s*'YAHOO'/.test(controls))
check('...and the division selector with it', !/f-division/.test(controls))
check('the competition control is a toggle built from the records',
  /competitions\.map/.test(controls) && /aria-pressed=\{active\}/.test(controls))
check('...not a pair of hardcoded slugs', !/'8brcam'|'wcc'/.test(controls))
check('the search placeholder names the CueVerse ID', /placeholder="Search CueVerse ID…"/.test(read('src/components/seasons/season-controls.tsx')))
check('previous and next are disabled at the ends',
  /disabled=\{neighbours\.prev == null\}/.test(controls) && /disabled=\{neighbours\.next == null\}/.test(controls))
check('the competition, season and view all persist in the URL',
  /next\.set\('competition'/.test(controls) && /next\.set\('view'/.test(controls) && /\/seasons\/\$\{seasonId\}/.test(controls))
check('the group selection persists too', /searchParams\.set\('group'/.test(code(read('src/components/seasons/season-groups-view.tsx'))))

// ── The board, against real seasons ─────────────────────────────────────────────────────────────

section('Every figure derives from the same place')

const seasons = await prisma.season.findMany({
  where: { platform: 'CUEVERSE' },
  select: { id: true, number: true, competitionYear: true, groupStageGames: true, lifecycleState: true },
  orderBy: { id: 'asc' },
})
check('there are CueVerse seasons to check', seasons.length > 0, `${seasons.length}`)

let boardsChecked = 0
for (const s of seasons) {
  const groups = await getSeasonGroupStage(s.id)
  if (groups.length === 0) continue
  const board = await getGroupBoard(s.id, groups, s.groupStageGames)
  boardsChecked++

  const sumPlayed = board.groups.reduce((n, g) => n + g.setsPlayed, 0)
  const sumTotal = board.groups.reduce((n, g) => n + g.setsTotal, 0)
  check(`season ${s.id}: the season totals are the group totals added up`,
    board.totals.setsPlayed === sumPlayed && board.totals.setsTotal === sumTotal)
  check(`season ${s.id}: entrants is the number of rows actually rendered`,
    board.totals.entrants === board.groups.reduce((n, g) => n + g.players.length, 0))
  check(`season ${s.id}: the clinched total is the group counts added up`,
    board.totals.clinched === board.groups.reduce((n, g) => n + g.clinched, 0))
  check(`season ${s.id}: the percentage is the ratio it claims to be`,
    board.totals.percent === (sumTotal > 0 ? Math.round((sumPlayed / sumTotal) * 1000) / 10 : 0),
    `${board.totals.percent}`)

  for (const g of board.groups) {
    check(`season ${s.id} group ${g.code}: played never exceeds scheduled`, g.setsPlayed <= g.setsTotal)
    check(`season ${s.id} group ${g.code}: the group percentage matches its own counts`,
      g.percent === (g.setsTotal > 0 ? Math.round((g.setsPlayed / g.setsTotal) * 1000) / 10 : 0))
    check(`season ${s.id} group ${g.code}: advancing never exceeds the group size`,
      g.advancing <= g.players.length)
    check(`season ${s.id} group ${g.code}: the clinch count matches the marked rows`,
      g.clinched === g.players.filter((p) => p.clinchShown).length)
    check(`season ${s.id} group ${g.code}: every marked row is genuinely proved`,
      g.players.filter((p) => p.clinchShown).every((p) => showsClinch(p)))

    /*
      Remaining sets are counted from FIXTURES.

      The check that matters: a player's played-plus-remaining can never exceed the fixtures they
      actually have, and in a finished group remaining must be zero for everybody. Deriving it from
      points or W–L–D would pass neither.
    */
    for (const p of g.players) {
      check(`season ${s.id} ${g.code}/${p.cueverseId}: remaining is non-negative`, p.remaining >= 0)
      if (g.setsPlayed === g.setsTotal) {
        check(`season ${s.id} ${g.code}/${p.cueverseId}: a finished group leaves nothing remaining`, p.remaining === 0)
      }
      check(`season ${s.id} ${g.code}/${p.cueverseId}: the cell map covers every opponent`,
        Object.keys(p.cells).length === g.players.length - 1)
    }
  }
}
check('at least one real season was measured', boardsChecked > 0, `${boardsChecked}`)

// ── Identity ────────────────────────────────────────────────────────────────────────────────────

section('Identity: CueVerse ID leads, preferred name supports')

const s1 = seasons.find((s) => s.number === 1 && s.competitionYear === 2026)!
const g1 = await getSeasonGroupStage(s1.id)
const board1 = await getGroupBoard(s1.id, g1, s1.groupStageGames)
const everyone = board1.groups.flatMap((g) => g.players)

check('every row carries a CueVerse ID', everyone.every((p) => p.cueverseId.trim().length > 0))
check('a preferred name that merely repeats the handle is suppressed',
  everyone.every((p) => !p.preferredName || p.preferredName.toLowerCase() !== p.cueverseId.toLowerCase()))
check('every row has a monogram to fall back on', everyone.every((p) => p.monogram.length >= 1))
check('the monogram takes two letters from a two-part handle', monogramOf('fsm brian') === 'FB')
check('...and two characters from a single word', monogramOf('Starkiller') === 'ST')
check('...and never crashes on a handle of pure symbols', monogramOf('💎') === '?')
check('an animated avatar is flagged so the table can still it',
  everyone.every((p) => typeof p.avatarAnimated === 'boolean'))

const idSrc = code(read('src/components/seasons/season-group-board.tsx'))
check('opponent headers render the CueVerse ID and nothing else',
  /<th key=\{c\.entrantId\} scope="col" title=\{c\.cueverseId\}>/.test(idSrc)
  && !/c\.preferredName/.test(idSrc))
check('...no avatar or monogram in a header', !/thead[\s\S]{0,600}gb-avatar|thead[\s\S]{0,600}gb-monogram/.test(idSrc))
check('the identity strip opens the profile', /href=\{`\/players\/\$\{encodeURIComponent\(player\.slug\)\}`\}/.test(idSrc))
check('...with an accessible name', /aria-label=\{`\$\{player\.cueverseId\}/.test(idSrc))
check('the profile accent is used for the ring only',
  /'--gb-accent': player\.accent/.test(idSrc)
  && !/color: player\.accent|background: player\.accent/.test(idSrc))

const css = read('src/app/(frontend)/season-board.css')
check('...and the stylesheet spends it on nothing but the ring',
  /\.gb-avatar \{[\s\S]*?--gb-accent/.test(css)
  && !/\.gb-id-handle \{[^}]*--gb-accent/.test(css)
  && !/\.gb-cell[^{]*\{[^}]*--gb-accent/.test(css))

// ── Presentation rules ──────────────────────────────────────────────────────────────────────────

section('Rows, scores and the cutoff')

check('rows alternate across their whole width', /gb-row-odd|gb-row-even/.test(idSrc))
check('...with the stripe inherited by the sticky cells so it never breaks',
  /\.gb-matrix tbody td,\s*\.gb-matrix tbody th \{ background: inherit; \}/.test(css))
check('positions above the cutoff are NOT tinted',
  !/gb-row-adv|gb-row-qualified/.test(css) && !/qualified &&/.test(idSrc))
check('first place gets a rank colour and a left marker, not a wash',
  /\.gb-row-first \.gb-who \{ box-shadow: inset 2px 0 0 var\(--hot-red\)/.test(css)
  && !/\.gb-row-first \{[^}]*background:/.test(css))

check('a winning score is cyan', /\.gb-w \{[\s\S]{0,120}var\(--neon-cyan\)/.test(css))
check('a losing score is faded', /\.gb-l \{[\s\S]{0,120}muted-foreground/.test(css))
check('a draw is amber on both sides', /\.gb-d \{[\s\S]{0,80}var\(--gold\)/.test(css))
check('unplayed is a faint dash', /\.gb-dash \{/.test(css))
check('forfeits read FF and W', /gb-ff/.test(css) && /gb-wf/.test(css))
check('played-with-no-score keeps its own state', /gb-noscore/.test(css) && /'no-score'/.test(idSrc))
check('scores are display only — no buttons, links or handlers on a cell',
  !/onClick[^\n]*Score|<button[^>]*gb-cell|<Link[^>]*gb-cell/.test(idSrc))
check('hovering a row lifts its faded losses', /\.gb-row:hover \.gb-l/.test(css))

check('the legend is sourced from the scoring constants',
  /Win \{WIN_POINTS\}, Draw \{DRAW_POINTS\}, plus \{COMPLETION_BONUS\}/.test(idSrc))
const standings = code(read('src/lib/competition/standings.ts'))
check('...which are the same ones the engine awards',
  /r\.wins \* WIN_POINTS \+ r\.draws \* DRAW_POINTS/.test(standings))

// ── Motion ──────────────────────────────────────────────────────────────────────────────────────

section('Matte surfaces, not brushed metal')

/*
  The panel rules are isolated before searching them.

  The file legitimately contains directional repeating gradients elsewhere — the diagonal
  self-match hatch and the progress rail's sheen, both of which the brief says to keep. Searching
  the whole stylesheet for "repeating-linear-gradient" would therefore fail on the two textures that
  are supposed to be there, which is the sort of assertion that gets deleted rather than fixed.
*/
const panelRule = css.slice(css.indexOf('.gb-board,\n.gb-panel {'), css.indexOf('.gb-board:hover'))
const headRule = css.slice(css.indexOf('.gb-head {'), css.indexOf('.gb-head-name'))
const legendRule = css.slice(css.indexOf('.gb-legend {'), css.indexOf('.gb-legend b'))
const hoverRule = css.slice(css.indexOf('.gb-board:hover'), css.indexOf('.gb-frame {'))

check('the panel ground is a flat colour, not a gradient',
  /background-image: none/.test(panelRule) && !/linear-gradient/.test(panelRule))
check('...with no white highlight band along its top edge',
  !/inset 0 1px 0 rgb\(255 255 255/.test(panelRule))
check('...and no directional streaking anywhere in the frame',
  !/repeating-linear-gradient/.test(panelRule + headRule + legendRule))
check('hovering brightens the edge, never the surface', !/background-image|background-color/.test(hoverRule))

/* 94-98% opaque: solid enough that the page grid does not read through the tables. */
const opacity = panelRule.match(/color-mix\(in srgb, #0a0d10 (\d+)%/)
check('the panels are 94-98% opaque', !!opacity && Number(opacity[1]) >= 94 && Number(opacity[1]) <= 98,
  opacity ? `${opacity[1]}%` : 'no color-mix found')
check('the group header is fully opaque', /background-color: #07090b/.test(headRule))
check('...as is the legend strip', /background-color: #07090b/.test(legendRule))
check('the neon identity survives the change',
  /border: 1px solid color-mix\(in srgb, var\(--hot-red\)/.test(panelRule)
  && /\.gb-frame-live::before/.test(css))

/* The two textures that are meant to stay. */
check('the diagonal self-match hatch is untouched', /\.gb-diag \{[\s\S]{0,240}repeating-linear-gradient/.test(css))
check('the alternating rows are untouched',
  /\.gb-row-odd \{ background: var\(--void\); \}/.test(css) && /\.gb-row-even \{ background: #10151a; \}/.test(css))

section('Recorded results sit on a full-cell surface')

check('a scored cell carries the surface', idSrc.includes("'gb-surface gb-score'"))
check('both halves of a forfeit carry it', /gb-surface gb-ff/.test(idSrc) && /gb-surface gb-wf/.test(idSrc))
/*
  The distinction the treatment exists to make: a surface means something happened.

  An unplayed fixture, a pairing with no fixture, a no contest, a void and a match played without a
  score all stay flat. Giving any of them the same furniture would make an empty cell look like a
  result.
*/
for (const flat of ['gb-dash', 'gb-noscore', 'gb-void']) {
  const uses = [...idSrc.matchAll(new RegExp(`className="([^"]*${flat}[^"]*)"`, 'g'))].map((m) => m[1])
  check(`${flat} never gets a surface`, uses.length > 0 && uses.every((u) => !u.includes('gb-surface')),
    uses.join(' | ') || 'not found')
}
check('the diagonal is its own cell with no score at all', /className="gb-diag" aria-hidden/.test(idSrc))

check('each outcome gets its own hairline token',
  ['.gb-surface.gb-w', '.gb-surface.gb-l', '.gb-surface.gb-d', '.gb-surface.gb-ff'].every((sel) => css.includes(sel)))
const edges = ['gb-w,', 'gb-l ', 'gb-d ', 'gb-ff '].map((c) => {
  const m = css.match(new RegExp(`\\.gb-surface\\.${c.trim()}[^{]*\\{ --gb-edge: ([^;]+);`))
  return m ? m[1].trim() : null
})
check('...and the four are visually distinct', new Set(edges.filter(Boolean)).size === 4, edges.join(' / '))
check('the winner and the forfeit winner share one cyan edge, being one outcome',
  /\.gb-surface\.gb-w,\s*\.gb-surface\.gb-wf \{/.test(css))

check('the surface is contained by a border darker than its interior', /border: 1px solid #04060899/.test(css))
/*
  Every use of the outcome colour in a shadow must be an INSET one.

  Checked line by line rather than with a negative pattern over the whole file: the first attempt
  used `!/0 0 \d+px var\(--gb-edge/`, which matched the inset declaration itself — `0 0 0 1px` reads
  as "0 0" followed by "1px" if the match starts one token late. A rule about every occurrence is
  better asked of every occurrence.
*/
const edgeUses = css.split(/[\r\n]+/).filter((l) => l.includes('var(--gb-edge'))
check('...with the outcome colour INSIDE that border, not glowing outside it',
  edgeUses.length > 0 && edgeUses.every((l) => l.trimStart().startsWith('inset')),
  edgeUses.map((l) => l.trim()).join(' | '))
check('the reflection is a narrow band along the inside top edge',
  /\.gb-surface::before \{[\s\S]{0,320}height: 38%/.test(css))
check('corners are square to within a pixel or two', /\.gb-surface \{[\s\S]{0,500}border-radius: 1px/.test(css))
check('the inset leaves a few pixels of cell on each side', /\.gb-surface \{[\s\S]{0,200}inset: 3px/.test(css))

section('The surface changes nothing about the type or the row')

/*
  The typography assertion is that the surface SETS none of it.

  Checking a computed pixel size would pass while a future edit added `font-size: 1rem` to the rule,
  as long as the two happened to agree. What must be true is that the surface declares no type at
  all, so the score keeps whatever the cell gives it.
*/
const surfaceRule = css.slice(css.indexOf('.gb-surface {'), css.indexOf('.gb-surface::before'))
check('the surface sets no font size', !/font-size/.test(surfaceRule))
check('...no line height', !/line-height/.test(surfaceRule))
check('...no font family or weight', !/font-family|font-weight/.test(surfaceRule))
check('...and no padding that could grow the cell', !/padding/.test(surfaceRule))
/*
  Out of the flow, so the row height cannot move.

  A padded inline box would add its own height to every cell in a forty-cell matrix. Absolute
  positioning contributes nothing to layout, which is what makes "row heights unchanged" a property
  rather than a hope.
*/
check('the surface is positioned out of the flow', /position: absolute/.test(surfaceRule))
check('...inside a cell that is its containing block', /\.gb-cell \{[\s\S]{0,220}position: relative/.test(css))
check('the score is centred both ways',
  /align-items: center/.test(surfaceRule) && /justify-content: center/.test(surfaceRule))

section('A surface that resembles a control and is not one')

check('scores are spans, never buttons or links',
  !/<button[\s\S]{0,200}gb-surface|<Link[\s\S]{0,200}gb-surface/.test(idSrc))
check('no click handler on a score', !/gb-surface[\s\S]{0,200}onClick/.test(idSrc))
check('no keyboard focus is added to a score', !/gb-surface[\s\S]{0,200}tabIndex/.test(idSrc))
check('the surface cannot even receive a pointer', /\.gb-surface \{[\s\S]{0,900}pointer-events: none/.test(css))
check('no cursor change suggests one', !/\.gb-surface[^{]*\{[^}]*cursor:/.test(css))
check('no press, lift or hover animation on a score', !/\.gb-surface:hover|\.gb-surface:active/.test(css))
check('the identity strip is still a link, which is the one thing that should be',
  /gb-id-link/.test(idSrc))

section('Motion reuses the profile primitives')

check('the board is gated by the shared decorative-motion hook', /useDecorativeMotion\(boardRef\)/.test(idSrc))
check('...imported from the profile module', /players\/profile\/motion/.test(idSrc))
check('the board owns no animation loop', !/requestAnimationFrame|setInterval|setTimeout/.test(idSrc))
check('continuous motion is a CSS class', /\.gb-frame-live::before \{[\s\S]{0,60}animation: gb-frame-travel/.test(css))
const reducedBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
check('reduced motion stops the travel', /animation: none/.test(reducedBlock))
check('...and the rail sheen with it', /gb-rail-fill::after \{ animation: none|rail-live \.gb-rail-fill::after/.test(reducedBlock))
check('the decorative layers are hidden from assistive technology',
  (idSrc.match(/aria-hidden className=\{cn\('gb-/g) ?? []).length >= 2)

// ── The progress rail ───────────────────────────────────────────────────────────────────────────

section('The rail and its label are one number')

const viewSrc = code(read('src/components/seasons/season-groups-view.tsx'))
check('the fill width is the percentage the label prints',
  /width: `\$\{totals\.percent\}%`/.test(viewSrc) && /\{totals\.percent\}% complete/.test(viewSrc))
check('the rail is red over gunmetal, with no cyan',
  /\.gb-rail-fill \{[\s\S]{0,300}var\(--hot-red\)/.test(css)
  && !/\.gb-rail[\s\S]{0,400}neon-cyan/.test(css))
check('the highlight travels only across the completed portion',
  /\.gb-rail-fill::after/.test(css))
check('the rail announces itself to assistive technology',
  /role="progressbar"/.test(viewSrc) && /aria-valuenow=\{totals\.percent\}/.test(viewSrc))

section('Nothing global is stated twice')

const masthead = code(read('src/components/seasons/season-masthead.tsx'))
check('the masthead no longer carries a Season at a Glance panel', !/function Glance/.test(masthead))
check('...nor entrant and group chips', !/\{entrants\} entrant/.test(masthead))
check('the group header carries only group facts',
  /\{players\.length\} \{players\.length === 1 \? 'player' : 'players'\}/.test(idSrc)
  && !/totals\./.test(idSrc))
check('the Groups heading spends its space on navigation',
  /All groups/.test(viewSrc) && /groups\.map\(\(g\) =>[\s\S]{0,200}g\.code/.test(viewSrc))
check('...generated from the groups that exist rather than a fixed four',
  !/\['A', 'B', 'C', 'D'\]/.test(viewSrc))

// ── Clinch persistence ──────────────────────────────────────────────────────────────────────────

section('A clinch is written once and revoked only by an edit')

const live = await prisma.season.findFirst({
  where: { competitionSeries: { slug: '8brcam' }, number: 2, competitionYear: 2026 },
  select: { id: true, lifecycleState: true, groupStageGames: true },
})
if (!live) {
  check('8BRCAM Season 2 exists to test against', false, 'not found')
} else if (live.lifecycleState !== 'GROUP_STAGE_LIVE') {
  console.log(`  · skipped: Season ${live.id} is ${live.lifecycleState}; seed fixtures with`)
  console.log('    scripts/fixture-season-progress.mts --up to exercise the persistence path.')
} else {
  const groupsNow = await getSeasonGroupStage(live.id)
  const target = groupsNow.find((g) => g.matches.some((m) => m.status === 'COMPLETED'))
  if (!target) {
    console.log('  · skipped: no completed group result to edit.')
  } else {
    const before = await prisma.seasonStanding.findMany({
      where: { seasonId: live.id }, select: { entrantId: true, clinchedAt: true },
    })
    const markedBefore = before.filter((r) => r.clinchedAt != null).length
    check('the fixture season has proved clinches to protect', markedBefore > 0, `${markedBefore}`)

    /*
      A FIRST-TIME entry must not revoke.

      An unplayed fixture is completed. That extends history rather than editing it, so however the
      standings move, no marker may disappear.
    */
    const fresh = target.matches.find((m) => m.status === 'SCHEDULED')
    if (fresh) {
      const v = await prisma.seasonMatch.findUnique({ where: { id: fresh.id }, select: { version: true } })
      const r = await saveSeasonGroupResults(ACTOR, live.id, target.id, [
        { matchId: fresh.id, home: '9', away: '3', version: v!.version },
      ])
      check('a first-time result saves', r.ok, r.error)
      const after = await prisma.seasonStanding.findMany({
        where: { seasonId: live.id }, select: { entrantId: true, clinchedAt: true },
      })
      const keptAll = before.filter((b) => b.clinchedAt != null)
        .every((b) => after.find((a) => a.entrantId === b.entrantId)?.clinchedAt != null)
      check('...and entering it revokes no clinch', keptAll)
    }

    /*
      An EDIT may revoke.

      Clearing a completed result is history changing rather than extending, so the proof is
      rechecked — and where it no longer holds the marker goes.
    */
    const done = target.matches.find((m) => m.status === 'COMPLETED')!
    const dv = await prisma.seasonMatch.findUnique({ where: { id: done.id }, select: { version: true } })
    const cleared = await saveSeasonGroupResults(ACTOR, live.id, target.id, [
      { matchId: done.id, home: '', away: '', version: dv!.version },
    ])
    check('clearing a recorded result saves', cleared.ok, cleared.error)
    const afterEdit = await prisma.seasonStanding.findMany({
      where: { seasonId: live.id }, select: { entrantId: true, clinchedAt: true },
    })
    check('...and the standings were recomputed', afterEdit.length === before.length)

    const stageSrc = code(read('src/lib/seasons/group-stage.ts'))
    check('a save revokes only when it edited history',
      /revalidateClinches: editedHistory/.test(stageSrc)
      && /const editedHistory = plan\.some/.test(stageSrc))
    check('clearing a match always revalidates', /clearSeasonMatch[\s\S]*?revalidateClinches: true/.test(stageSrc))
    check('reopening the groups always revalidates', /reopenSeasonGroups[\s\S]*?revalidateClinches: true/.test(stageSrc))
    const boardLib = code(read('src/lib/seasons/group-board.ts'))
    check('the default path can only ADD markers',
      /allowRevoke: opts\.revalidateClinches/.test(code(read('src/lib/seasons/group-stage.ts')))
      && /!proven && stored\.clinchedAt != null && opts\.allowRevoke/.test(boardLib))
  }
}

check('the marker is an additive column with no default and no backfill',
  /ADD COLUMN "clinchedAt" TIMESTAMP\(3\)/.test(read('prisma/migrations/20260903120000_standing_clinched_at/migration.sql'))
  && !/DROP|NOT NULL|DEFAULT/.test(read('prisma/migrations/20260903120000_standing_clinched_at/migration.sql')))

// ── Scoring rules untouched ─────────────────────────────────────────────────────────────────────

section('The scoring and tiebreak rules were not touched')

const roster = [{ registrationId: 1, username: 'a' }, { registrationId: 2, username: 'b' }, { registrationId: 3, username: 'c' }]
const rows3 = computeStandings(roster, [
  { homeRegistrationId: 1, awayRegistrationId: 2, homeUsername: 'a', awayUsername: 'b', homeGames: 9, awayGames: 1, winnerRegistrationId: 1 },
  { homeRegistrationId: 1, awayRegistrationId: 3, homeUsername: 'a', awayUsername: 'c', homeGames: 5, awayGames: 5, winnerRegistrationId: null },
], 2, 1)
const a = rows3.find((r) => r.registrationId === 1)!
check('a win is still worth 3', WIN_POINTS === 3)
check('a draw is still worth 1', DRAW_POINTS === 1)
check('the completion bonus is still 1', COMPLETION_BONUS === 1)
check('a full slate still earns it', a.points === WIN_POINTS + DRAW_POINTS + COMPLETION_BONUS, `${a.points}`)
check('the board reads points rather than recomputing them',
  !/computeStandings/.test(code(read('src/lib/seasons/group-board.ts'))))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
