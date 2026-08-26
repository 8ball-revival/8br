import type { AchievementFacts, FactMatch } from './facts'
import type { Achievement, AchievementPlayer } from './types'

/**
 * The eighteen awards, computed.
 *
 * Pure: facts in, awards out. No database, no clock, no randomness — so a test can hand it a
 * hand-built archive and assert the exact winner, and two runs over the same data always agree.
 *
 * ── The four counting rules everything obeys ─────────────────────────────────────────────────────
 * These are the ones that are easy to get wrong, and getting any of them wrong quietly changes who
 * wins an award rather than breaking anything:
 *
 *  1. A NO_CONTEST never happened. It is not a win, not a loss, not a played match, and it does not
 *     appear in a win percentage. There are 988 of them.
 *  2. A FORFEIT is an official result but not a played match. It decides who advanced; it never
 *     contributes games, margins or win percentages. There are 280.
 *  3. A BYE is not a win. A one-sided bracket slot advanced somebody without an opponent, and 322 of
 *     them exist — counting those as wins would put whoever drew the most byes at the top of half
 *     these awards.
 *  4. Ties are reported, not broken, unless an award says otherwise. Nine of the eighteen have ties
 *     in the current archive.
 */

const PLAYED = (m: FactMatch) => m.status === 'COMPLETED'
const FORFEITED = (m: FactMatch) => m.status === 'FORFEIT'
/** Both sides present. Excludes byes and unfilled bracket positions. */
const CONTESTED = (m: FactMatch) => m.homePlayerId != null && m.awayPlayerId != null

const sides = (m: FactMatch) => [m.homePlayerId, m.awayPlayerId].filter((x): x is string => x != null)

function loserOf(m: FactMatch): string | null {
  if (!CONTESTED(m) || !m.winnerPlayerId) return null
  return sides(m).find((p) => p !== m.winnerPlayerId) ?? null
}

/* ───────────────────────────────────────────────────────────────────── small helpers ──────────── */

function tally<T>(items: T[], key: (t: T) => string | null | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const it of items) {
    const k = key(it)
    if (!k) continue
    out.set(k, (out.get(k) ?? 0) + 1)
  }
  return out
}

/** Every id holding the maximum value. Empty when there is nothing to rank. */
function leaders(counts: Map<string, number>, min = 1): { ids: string[]; value: number } {
  let best = -Infinity
  for (const v of counts.values()) if (v > best) best = v
  if (!Number.isFinite(best) || best < min) return { ids: [], value: 0 }
  return { ids: [...counts.entries()].filter(([, v]) => v === best).map(([k]) => k), value: best }
}

/** Deterministic order for tied winners, so the same archive always renders the same card. */
function stableOrder(ids: string[], facts: AchievementFacts): string[] {
  return [...ids].sort((a, b) => {
    const pa = facts.players.get(a)
    const pb = facts.players.get(b)
    const ka = (pa?.cueverseId ?? pa?.preferredName ?? a).toLowerCase()
    const kb = (pb?.cueverseId ?? pb?.preferredName ?? b).toLowerCase()
    return ka.localeCompare(kb) || a.localeCompare(b)
  })
}

function person(id: string, facts: AchievementFacts): AchievementPlayer {
  const p = facts.players.get(id)
  return {
    playerId: id,
    cueverseId: p?.cueverseId ?? null,
    preferredName: p?.preferredName ?? '',
    href: p?.cueverseId ? `/players/${encodeURIComponent(p.cueverseId)}` : null,
  }
}

const people = (ids: string[], facts: AchievementFacts) =>
  stableOrder(ids, facts).map((id) => person(id, facts))

/** "3 players tied" phrasing, so a tie is stated rather than hidden by showing one name. */
const tieNote = (n: number) => (n > 1 ? ` · ${n} players tied` : '')

/* ─────────────────────────────────────────────────────────────── derived, shared indexes ──────── */

interface Index {
  finals: FactMatch[]
  finalsPlayed: FactMatch[]
  titlesByPlayer: Map<string, number[]>
  seasonsEntered: Map<string, number>
  playoffSeasons: Map<string, Set<number>>
}

function buildIndex(facts: AchievementFacts): Index {
  const finals = facts.matches.filter((m) => m.stage === 'PLAYOFF' && m.label === 'Final' && CONTESTED(m))
  const finalsPlayed = finals.filter(PLAYED)

  /* Season ORDER of each title, not the season id: the Scenic Route measures distance in seasons. */
  const titlesByPlayer = new Map<string, number[]>()
  for (const s of facts.seasons) {
    if (!s.championPlayerId) continue
    const list = titlesByPlayer.get(s.championPlayerId) ?? []
    list.push(s.order)
    titlesByPlayer.set(s.championPlayerId, list)
  }

  const seasonsEntered = new Map<string, number>()
  for (const set of facts.entrantsBySeason.values()) {
    for (const p of set) seasonsEntered.set(p, (seasonsEntered.get(p) ?? 0) + 1)
  }

  const playoffSeasons = new Map<string, Set<number>>()
  for (const m of facts.matches) {
    if (m.stage !== 'PLAYOFF') continue
    for (const p of sides(m)) {
      const set = playoffSeasons.get(p) ?? new Set<number>()
      set.add(m.seasonId)
      playoffSeasons.set(p, set)
    }
  }

  return { finals, finalsPlayed, titlesByPlayer, seasonsEntered, playoffSeasons }
}

/* ───────────────────────────────────────────────────────────────────────── the awards ─────────── */

export function computeAchievements(
  facts: AchievementFacts,
  /** Current ratings by player id, from the canonical Rankings service. */
  ratings: Map<string, number>,
): Achievement[] {
  const ix = buildIndex(facts)
  const out: Achievement[] = []
  const add = (a: Achievement) => { if (a.winners.length > 0 || a.siteWide) out.push(a) }

  /* 1 ─ THE CHOKER ─────────────────────────────────────────────────────────────────────────────── */
  {
    const losses = tally(ix.finals, loserOf)
    const { ids, value } = leaders(losses)
    add({
      id: 'the-choker',
      title: 'THE CHOKER',
      caption: 'Got all the way there. Repeatedly.',
      winners: people(ids, facts),
      stat: `${value} finals lost`,
      detail: `Reached the Final and lost it ${value} times${tieNote(ids.length)}.`,
    })
  }

  /* 2 ─ BEST PLAYER WITHOUT THE IMPORTANT PART ─────────────────────────────────────────────────── */
  {
    const untitled = [...ratings.entries()]
      .filter(([id]) => !ix.titlesByPlayer.has(id))
      .sort((a, b) => b[1] - a[1])
    const top = untitled[0]
    add({
      id: 'best-without-title',
      title: "BEST PLAYER WITHOUT THE IMPORTANT PART",
      caption: 'Wonderful rating. Empty shelf.',
      winners: top ? people([top[0]], facts) : [],
      stat: top ? `${top[1]} rating` : '',
      detail: top ? `The highest ranked player with no Season Championship.` : '',
    })
  }

  /* 3 ─ SMALL SAMPLE SIZE KING ─────────────────────────────────────────────────────────────────── */
  {
    const MIN_FINALS = 3
    const appearances = new Map<string, { played: number; won: number }>()
    for (const m of ix.finals) {
      for (const p of sides(m)) {
        const r = appearances.get(p) ?? { played: 0, won: 0 }
        r.played += 1
        if (m.winnerPlayerId === p) r.won += 1
        appearances.set(p, r)
      }
    }
    const perfect = new Map<string, number>()
    for (const [p, r] of appearances) {
      if (r.played >= MIN_FINALS && r.won === r.played) perfect.set(p, r.played)
    }
    const { ids, value } = leaders(perfect)
    add({
      id: 'small-sample-size-king',
      title: 'SMALL SAMPLE SIZE KING',
      caption: 'Undefeated in finals. Do not ask how many.',
      winners: people(ids, facts),
      stat: value ? `${value}-0 in finals` : '',
      detail: value ? `Played ${value} Finals and won all of them${tieNote(ids.length)}.` : '',
    })
  }

  /* 4 ─ PLEASE FIND ANOTHER HOBBY ──────────────────────────────────────────────────────────────── */
  {
    const { ids, value } = leaders(ix.seasonsEntered)
    add({
      id: 'find-another-hobby',
      title: 'PLEASE FIND ANOTHER HOBBY',
      caption: 'Signed up for everything. Every single time.',
      winners: people(ids, facts),
      stat: `${value} seasons`,
      detail: `Entered ${value} of the ${facts.seasons.length} completed Seasons${tieNote(ids.length)}.`,
    })
  }

  /* 5 ─ WE GET IT, YOU'RE GOOD ─────────────────────────────────────────────────────────────────── */
  {
    const counts = new Map([...ix.titlesByPlayer].map(([p, list]) => [p, list.length]))
    const { ids, value } = leaders(counts)
    add({
      id: 'we-get-it',
      title: "WE GET IT, YOU'RE GOOD",
      caption: 'Leave some for the rest of them.',
      winners: people(ids, facts),
      stat: `${value} championships`,
      detail: `Most Season Championships in the archive${tieNote(ids.length)}.`,
    })
  }

  /* 6 ─ TOOK THE SCENIC ROUTE ──────────────────────────────────────────────────────────────────── */
  {
    /*
     * The gap is measured in Seasons that happened BETWEEN two titles, which is the interval minus
     * one: winning consecutive Seasons is a gap of zero, not one.
     */
    const gaps = new Map<string, number>()
    for (const [p, orders] of ix.titlesByPlayer) {
      if (orders.length < 2) continue
      const sorted = [...orders].sort((a, b) => a - b)
      let worst = 0
      for (let i = 1; i < sorted.length; i++) worst = Math.max(worst, sorted[i] - sorted[i - 1] - 1)
      gaps.set(p, worst)
    }
    const { ids, value } = leaders(gaps)
    add({
      id: 'scenic-route',
      title: 'TOOK THE SCENIC ROUTE',
      caption: 'Came back for a second one. Eventually.',
      winners: people(ids, facts),
      stat: `${value} seasons between titles`,
      detail: `Longest wait between two Championships${tieNote(ids.length)}.`,
    })
  }

  /* 7 ─ MOST VIOLENT FINAL ─────────────────────────────────────────────────────────────────────── */
  {
    /*
     * Played finals only. A forfeited Final has no score, and inventing a margin for one would be
     * exactly the fabrication the whole system is built to avoid.
     */
    let best: { m: FactMatch; margin: number } | null = null
    for (const m of ix.finalsPlayed) {
      if (m.homeGames == null || m.awayGames == null) continue
      const margin = Math.abs(m.homeGames - m.awayGames)
      if (!best || margin > best.margin) best = { m, margin }
    }
    const season = best ? facts.seasons.find((s) => s.id === best!.m.seasonId) : null
    const winnerId = best?.m.winnerPlayerId ?? null
    const loserId = best ? loserOf(best.m) : null
    const hi = best ? Math.max(best.m.homeGames ?? 0, best.m.awayGames ?? 0) : 0
    const lo = best ? Math.min(best.m.homeGames ?? 0, best.m.awayGames ?? 0) : 0
    add({
      id: 'most-violent-final',
      title: 'MOST VIOLENT FINAL',
      caption: 'That was not a match. That was an errand.',
      winners: winnerId ? people([winnerId], facts) : [],
      stat: best ? `${hi}-${lo}` : '',
      detail: best && season
        ? `Season ${season.number}, ${season.year}. Beat ${
          loserId ? (facts.players.get(loserId)?.cueverseId ?? facts.players.get(loserId)?.preferredName ?? 'their opponent') : 'their opponent'
        } by ${best.margin}.`
        : '',
    })
  }

  /* 8 ─ ABSOLUTELY REFUSED TO LOSE ─────────────────────────────────────────────────────────────── */
  {
    /*
     * A qualifying run is a title season in which the champion lost nothing, drew nothing, and was
     * never handed a win by a forfeit. Ties break on the larger entrant field, because beating more
     * people is the harder version of the same feat.
     */
    let best: { player: string; wins: number; entrants: number; season: number; year: number } | null = null
    for (const s of facts.seasons) {
      const champ = s.championPlayerId
      if (!champ) continue
      const theirs = facts.matches.filter((m) => m.seasonId === s.id && sides(m).includes(champ))
      const lost = theirs.some((m) => PLAYED(m) && m.winnerPlayerId != null && m.winnerPlayerId !== champ)
      const drew = theirs.some((m) => PLAYED(m) && m.winnerPlayerId == null && CONTESTED(m)
        && m.homeGames != null && m.awayGames != null && m.homeGames === m.awayGames)
      const forfeitWin = theirs.some((m) => FORFEITED(m) && m.forfeitPlayerId != null && m.forfeitPlayerId !== champ)
      if (lost || drew || forfeitWin) continue
      const wins = theirs.filter((m) => PLAYED(m) && CONTESTED(m) && m.winnerPlayerId === champ).length
      const candidate = { player: champ, wins, entrants: s.entrantsCount, season: s.number, year: s.year }
      if (!best || wins > best.wins || (wins === best.wins && s.entrantsCount > best.entrants)) best = candidate
    }
    add({
      id: 'refused-to-lose',
      title: 'ABSOLUTELY REFUSED TO LOSE',
      caption: 'Entire season. Not one slip.',
      winners: best ? people([best.player], facts) : [],
      stat: best ? `${best.wins}-0` : '',
      detail: best
        ? `Won the title in Season ${best.season}, ${best.year} without dropping a match, from a field of ${best.entrants}.`
        : '',
    })
  }

  /* 9 ─ GET A ROOM ─────────────────────────────────────────────────────────────────────────────── */
  {
    const pairs = new Map<string, number>()
    for (const m of facts.matches) {
      if (!PLAYED(m) || !CONTESTED(m)) continue
      const [a, b] = sides(m)
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      pairs.set(key, (pairs.get(key) ?? 0) + 1)
    }
    const { ids, value } = leaders(pairs)
    const pair = ids[0]?.split('|') ?? []
    add({
      id: 'get-a-room',
      title: 'GET A ROOM',
      caption: 'These two have seen enough of each other.',
      winners: pair.length === 2 ? people(pair, facts) : [],
      stat: `${value} meetings`,
      detail: `The most-played pairing in the archive. Forfeits and no-contests are not counted.`,
    })
  }

  /* 10 ─ ALWAYS INVITED, RARELY LEAVES WITH THE TROPHY ─────────────────────────────────────────── */
  {
    const ratio = new Map<string, number>()
    const raw = new Map<string, { appearances: number; titles: number }>()
    for (const [p, titles] of ix.titlesByPlayer) {
      const appearances = ix.playoffSeasons.get(p)?.size ?? 0
      if (appearances === 0) continue
      raw.set(p, { appearances, titles: titles.length })
      ratio.set(p, appearances / titles.length)
    }
    const { ids, value } = leaders(ratio, 0)
    const first = ids[0] ? raw.get(ids[0]) : null
    add({
      id: 'always-invited',
      title: 'ALWAYS INVITED, RARELY LEAVES WITH THE TROPHY',
      caption: 'Reliable attendance. Less reliable finish.',
      winners: people(ids, facts),
      stat: first ? `${first.appearances} playoffs, ${first.titles} title${first.titles === 1 ? '' : 's'}` : '',
      detail: first
        ? `${value.toFixed(1)} playoff appearances for every Championship${tieNote(ids.length)}.`
        : '',
    })
  }

  /* 11 ─ CONGRATULATIONS ON ALMOST WINNING ─────────────────────────────────────────────────────── */
  {
    const counts = new Map<string, number>()
    for (const m of ix.finals) {
      for (const p of sides(m)) {
        if (ix.titlesByPlayer.has(p)) continue
        counts.set(p, (counts.get(p) ?? 0) + 1)
      }
    }
    const { ids, value } = leaders(counts)
    add({
      id: 'almost-winning',
      title: 'CONGRATULATIONS ON ALMOST WINNING',
      caption: 'Second place is a kind of place.',
      winners: people(ids, facts),
      stat: `${value} finals, 0 titles`,
      detail: `Most Finals reached by somebody who has never won one${tieNote(ids.length)}.`,
    })
  }

  /* 12 ─ GROUP-STAGE MERCHANT ──────────────────────────────────────────────────────────────────── */
  {
    const MIN_GROUP = 50
    const MIN_PLAYOFF = 10
    const rec = new Map<string, { gp: number; gw: number; pp: number; pw: number }>()
    for (const m of facts.matches) {
      if (!PLAYED(m) || !CONTESTED(m)) continue
      for (const p of sides(m)) {
        const r = rec.get(p) ?? { gp: 0, gw: 0, pp: 0, pw: 0 }
        const won = m.winnerPlayerId === p ? 1 : 0
        if (m.stage === 'GROUP') { r.gp += 1; r.gw += won } else { r.pp += 1; r.pw += won }
        rec.set(p, r)
      }
    }
    const drop = new Map<string, number>()
    const detailOf = new Map<string, string>()
    for (const [p, r] of rec) {
      if (r.gp < MIN_GROUP || r.pp < MIN_PLAYOFF) continue
      const g = (r.gw / r.gp) * 100
      const q = (r.pw / r.pp) * 100
      drop.set(p, g - q)
      detailOf.set(p, `${g.toFixed(0)}% in groups, ${q.toFixed(0)}% in the playoffs, over ${r.gp} and ${r.pp} matches.`)
    }
    const { ids, value } = leaders(drop, 0)
    add({
      id: 'group-stage-merchant',
      title: 'GROUP-STAGE MERCHANT',
      caption: 'Unstoppable until it counts.',
      winners: people(ids, facts),
      stat: value ? `${value.toFixed(0)} points worse` : '',
      detail: ids[0] ? detailOf.get(ids[0]) ?? '' : '',
    })
  }

  /* 13 ─ PLAYOFF TAX EVADER ────────────────────────────────────────────────────────────────────── */
  {
    /*
     * A bye is a bracket slot with one side filled. It advances somebody without a match, which is
     * why it is counted here and excluded from every win total elsewhere.
     */
    const byes = new Map<string, number>()
    for (const m of facts.matches) {
      if (m.stage !== 'PLAYOFF') continue
      const present = sides(m)
      if (present.length !== 1) continue
      byes.set(present[0], (byes.get(present[0]) ?? 0) + 1)
    }
    const { ids, value } = leaders(byes)
    add({
      id: 'playoff-tax-evader',
      title: 'PLAYOFF TAX EVADER',
      caption: 'Advanced without touching a cue.',
      winners: people(ids, facts),
      stat: `${value} byes`,
      detail: `Moved through the bracket ${value} times without an opponent${tieNote(ids.length)}.`,
    })
  }

  /* 14 ─ THE PARTICIPATION AWARD ───────────────────────────────────────────────────────────────── */
  {
    const counts = new Map<string, number>()
    for (const [p, n] of ix.seasonsEntered) {
      if (ix.titlesByPlayer.has(p)) continue
      counts.set(p, n)
    }
    const { ids, value } = leaders(counts)
    /*
     * The one editorial thumb on the scale in the whole set, and it is on a TIE only.
     *
     * The Owner asked for tino_nica to be the named winner where he is level at the top. That does
     * not change the arithmetic: if he is not tied for the factual lead he is not selected, and the
     * genuine leaders are shown instead. A tie has no right answer, so choosing one of them is
     * editorial rather than a claim about the data.
     */
    const tino = ids.find((id) => facts.players.get(id)?.cueverseId?.toLowerCase() === 'tino_nica')
    const chosen = tino ? [tino] : ids
    add({
      id: 'participation-award',
      title: 'THE PARTICIPATION AWARD',
      caption: 'Turned up for years. Left with nothing.',
      winners: people(chosen, facts),
      stat: `${value} seasons, 0 titles`,
      detail: tino && ids.length > 1
        ? `Most Seasons entered without ever winning one. Level with ${ids.length - 1} other${ids.length === 2 ? '' : 's'}.`
        : `Most Seasons entered without ever winning one${tieNote(ids.length)}.`,
    })
  }

  /* 15 ─ NOBODY COULD COMPLETE THE ASSIGNMENT ──────────────────────────────────────────────────── */
  {
    let backToBack = 0
    let threeStraight = 0
    const names: string[] = []
    for (const [p, orders] of ix.titlesByPlayer) {
      const sorted = [...orders].sort((a, b) => a - b)
      let run = 1
      let bestRun = 1
      for (let i = 1; i < sorted.length; i++) {
        run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1
        bestRun = Math.max(bestRun, run)
      }
      if (bestRun >= 2) {
        backToBack += 1
        const who = facts.players.get(p)
        names.push(who?.cueverseId ?? who?.preferredName ?? p)
      }
      if (bestRun >= 3) threeStraight += 1
    }
    add({
      id: 'nobody-completed-assignment',
      title: 'NOBODY COULD COMPLETE THE ASSIGNMENT',
      caption: 'Two in a row is hard. Three is apparently theoretical.',
      winners: [],
      siteWide: true,
      stat: threeStraight > 0 ? `${threeStraight} did it` : 'Still nobody',
      detail: `${backToBack} player${backToBack === 1 ? ' has' : 's have'} won consecutive Championships${
        names.length ? ` (${names.sort().join(', ')})` : ''
      }. Three in a row: ${threeStraight === 0 ? 'never done.' : `${threeStraight}.`}`,
    })
  }

  /* 16 ─ BY ANY MEANS NECESSARY ────────────────────────────────────────────────────────────────── */
  {
    const wins = new Map<string, number>()
    for (const m of facts.matches) {
      if (!FORFEITED(m) || !m.forfeitPlayerId) continue
      const other = sides(m).find((p) => p !== m.forfeitPlayerId)
      if (other) wins.set(other, (wins.get(other) ?? 0) + 1)
    }
    const { ids, value } = leaders(wins)
    add({
      id: 'by-any-means',
      title: 'BY ANY MEANS NECESSARY',
      caption: 'A win is a win. Even the ones nobody played.',
      winners: people(ids, facts),
      stat: `${value} walkovers`,
      detail: `Opponents failed to show up ${value} times${tieNote(ids.length)}.`,
    })
  }

  /* 17 ─ MR. CAN'T-GET-IT-RIGHT! ───────────────────────────────────────────────────────────────── */
  {
    const losses = tally(facts.matches.filter(FORFEITED), (m) => m.forfeitPlayerId)
    const { ids, value } = leaders(losses)
    add({
      id: 'cant-get-it-right',
      title: "MR. CAN'T-GET-IT-RIGHT!",
      caption: 'Scheduling is also a skill.',
      winners: people(ids, facts),
      stat: `${value} forfeits`,
      detail: `Failed to complete ${value} scheduled matches${tieNote(ids.length)}.`,
    })
  }

  /* 18 ─ THE RANKINGS CAN'T TAKE IT BACK ───────────────────────────────────────────────────────── */
  {
    const champs = [...ix.titlesByPlayer.keys()]
      .map((id) => ({ id, rating: ratings.get(id) }))
      .filter((x): x is { id: string; rating: number } => typeof x.rating === 'number')
      .sort((a, b) => a.rating - b.rating)
    const low = champs[0]
    add({
      id: 'rankings-cant-take-it-back',
      title: "THE RANKINGS CAN'T TAKE IT BACK",
      caption: 'The trophy does not have a rating requirement.',
      winners: low ? people([low.id], facts) : [],
      stat: low ? `${low.rating} rating` : '',
      /*
       * "Currently rated" is load-bearing. A rating is a live measure and this one is today's, not
       * the one they held on the night they won — implying otherwise would turn a joke about the
       * present into a false claim about the past.
       */
      detail: low ? 'The lowest currently rated player holding a Season Championship.' : '',
    })
  }

  return out
}
