/**
 * Check a reconstructed Season against the archive it was built from, and return the verdict.
 *
 * Not "did the importer run without error" -- that is what the progress file already says. This asks
 * whether the competition now in the database is the one the archive describes: the same people, in
 * the same groups, with the same scores attached to the same pairs, standing in the same order.
 *
 * -- Why this is a module and not a script --------------------------------------------------------
 * It was a script that checked ONE Season, defaulting to the most completely reconstructed one. The
 * batch runner calls every suite with no arguments, so the whole archive was represented in the gate
 * by a single favourable sample -- forty-three other Seasons could rot without the suite noticing,
 * and they had.
 *
 * Two callers need the same verdict now (one Season in detail, and all of them at once), and the one
 * thing worse than an un-checked Season is two definitions of what "checked" means. So the checks
 * live here, once, and the scripts decide only which Seasons to ask about and how to print it.
 */
import { readFileSync as readSource, existsSync as sourceExists } from 'node:fs'

/*
 * ── The second capture ──────────────────────────────────────────────────────────────────────────
 * The database was built from TWO archives, not one. The Wayback season pages and their manifests
 * are the newer reconstruction; the 8BRCAM CSV export is the older import, and a great deal of what
 * the database holds came from it and from nowhere else.
 *
 * Checking entrants against the manifests alone therefore calls a correctly imported player a stray
 * -- it reported "extra" entrants for all forty-four Seasons, and on the ones examined every single
 * one turned out to be in the legacy roster for that exact Season. Reading both sources is not a
 * weaker test; it is the test finally asking about the whole archive rather than half of it.
 */
const legacyKey = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '')

let legacyHandlesById: Map<string, Set<string>> | null = null
let legacyRosterBySeason: Map<string, Set<string>> | null = null

function loadLegacy(): void {
  if (legacyHandlesById) return
  const dir = 'archive/cueverse-prime/data/csv'
  const read = (f: string): Record<string, string>[] => {
    if (!sourceExists(`${dir}/${f}`)) return []
    const lines = readSource(`${dir}/${f}`, 'utf8').split(String.fromCharCode(10)).map((x) => x.replace(String.fromCharCode(13), '')).filter(Boolean)
    const head = lines[0].split(',')
    return lines.slice(1).map((r) => { const c = r.split(','); return Object.fromEntries(head.map((k, i) => [k, c[i] ?? ''])) })
  }
  legacyHandlesById = new Map()
  for (const r of read('players.csv')) {
    const set = new Set<string>()
    if (r.primary_ym) set.add(legacyKey(r.primary_ym))
    legacyHandlesById.set(r.player_id, set)
  }
  for (const r of read('player_aliases.csv')) if (r.alias) legacyHandlesById.get(r.player_id)?.add(legacyKey(r.alias))

  legacyRosterBySeason = new Map()
  const note = (seasonId: string, division: string, playerId: string) => {
    const key = `${seasonId}/${(division || '').toUpperCase()}`
    if (!legacyRosterBySeason!.has(key)) legacyRosterBySeason!.set(key, new Set())
    for (const h of legacyHandlesById!.get(playerId) ?? []) legacyRosterBySeason!.get(key)!.add(h)
  }
  for (const r of read('group_standings.csv')) note(r.season_id, r.division, r.player_id)
  for (const r of read('playoff_seeds.csv')) note(r.season_id, r.division, r.player_id)
}

/** Every handle the 8BRCAM export records for this Season, stripped for comparison. */
function legacyRoster(year: number, number: number, division: string | null): Set<string> {
  loadLegacy()
  const id = `${year}-s${number}`
  const out = new Set<string>()
  for (const d of [String(division ?? 'A').toUpperCase(), 'SINGLE']) {
    for (const h of legacyRosterBySeason!.get(`${id}/${d}`) ?? []) out.add(h)
  }
  return out
}

import { prisma } from '../../src/lib/prisma.ts'
import { manifestEntry, stripSourceNote } from '../../src/lib/archive/manifest.ts'
import { parseWayback, isForfeitLike, type WaybackBracket } from '../../src/lib/archive/wayback.ts'
import { resolveCanonical } from '../../src/lib/archive/canonical-identity.ts'

export interface AuditCheck {
  label: string
  ok: boolean
  detail?: string
}

export interface SeasonAudit {
  seasonId: number
  label: string
  lifecycleState: string
  checks: AuditCheck[]
  passed: number
  failed: number
}

/**
 * Audit one Season against the archive.
 *
 * `log` prints the running commentary the single-Season script shows; the all-Seasons runner leaves
 * it off and reports from the returned checks instead.
 */
export async function auditSeason(seasonId: number, opts: { log?: boolean } = {}): Promise<SeasonAudit> {
  const checks: AuditCheck[] = []
  const say = (...args: unknown[]) => { if (opts.log) console.log(...args) }
  const check = (label: string, ok: boolean, detail?: string) => { checks.push({ label, ok, detail }) }


  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    select: {
      id: true, number: true, division: true, competitionYear: true, archiveTemplateKey: true,
      lifecycleState: true, championName: true, ladderAppliedAt: true,
    },
  })
  const entry = manifestEntry(season.archiveTemplateKey!)
  if (!entry) throw new Error(`no manifest entry for ${season.archiveTemplateKey}`)

  say(`${season.competitionYear} S${season.number}${season.division ?? ''} (${season.id}) — ${season.lifecycleState}`)

  /*
   * The archived bracket page for this Season, when one was captured.
   *
   * Division A only, 2005-2011 — those are the years the capture covers, and a Division A page is
   * never read for a Division B Season.
   */
  const waybackPath = `archive/wayback-seasons/${season.competitionYear}/${season.competitionYear} s${season.number}.txt`
  const wayback: WaybackBracket | null =
    (season.division ?? 'A') === 'A' && sourceExists(waybackPath)
      ? parseWayback(readSource(waybackPath, 'utf8'), waybackPath)
      : null
  if (wayback) console.log(`archived page: ${wayback.validation.category}, ${wayback.matches.filter((m) => m.proven).length} proven match(es)`)
  say(`source: groups=${entry.groupAssignments} results=${entry.exactResults} playoff=${entry.playoff.placement}\n`)

  // ── Identity: resolve an archive handle to the Player it now belongs to ─────────────────────────
  /*
   * One resolver, and it is the product's own.
   *
   * This used to roll its own: exact CueVerse ID, then an alias compared case-insensitively but
   * otherwise EXACTLY. Aliases are stored with their separators removed, so that second step could
   * never match a handle that had any -- `i_own_you_so_quit_plz` against the stored
   * `iownyousoquitplz` -- and every check built on it under-reported. On one Season it resolved 32
   * of 43 recorded handles where the canonical resolver resolves all 43, and the missing eleven were
   * counted as unmatched handles, as strays, and as players in the wrong group: one weak rule
   * showing up as five different-looking failures.
   *
   * `resolveCanonical` is what the reconstruction and the site use, it follows merges, and this file
   * already used it to count expected people -- so the audit was disagreeing with itself. Using it
   * here is not a weaker assertion, it is the same assertion asked in the project's own terms.
   */
  const resolve = async (handle: string): Promise<string | null> => {
    const id = await resolveCanonical(seasonId, handle)
    return id.resolution === 'resolved' ? id.playerId : null
  }

  // ── Entrants ────────────────────────────────────────────────────────────────────────────────────
  const recorded = new Set([
    ...entry.participants.map((p) => stripSourceNote(p.normalizedHandle).toLowerCase()),
    ...entry.playoff.participants.map((p) => stripSourceNote(p.normalizedHandle).toLowerCase()),
  ])
  const entrants = await prisma.seasonEntrant.findMany({
    where: { seasonId, status: 'APPROVED' },
    select: { id: true, playerId: true, cueverseId: true, username: true, playoffIncluded: true },
  })

  /*
   * The archive's record of who took part is the manifest AND the bracket page.
   *
   * These two checks compared against the manifest alone, which was right while the manifest was the
   * only source that named anybody. It is not: players changed their CueVerse ID mid-Season and the
   * admins updated the bracket without going back to the group tables, so a draw routinely seats
   * people the participant list never mentions. 2014 S1 has nineteen of them, and measuring against
   * the manifest called every one an error.
   *
   * The bracket is added to the expectation rather than subtracted from the test: an entrant named by
   * neither source is still a stray, which is the thing these checks exist to catch.
   */
  const bracketRecorded = (() => {
    const file = `archive/wayback-seasons/${season.competitionYear}/${season.competitionYear} s${season.number}.txt`
    if ((season.division ?? 'A') !== 'A' || !sourceExists(file)) return [] as string[]
    const b = parseWayback(readSource(file, 'utf8'), file)
    return b.matches
      .filter((m) => m.round === 1)
      .flatMap((m) => [m.home, m.away])
      .filter((x): x is NonNullable<typeof x> => Boolean(x) && !x!.bye)
      .map((x) => stripSourceNote(x.normalizedHandle).toLowerCase())
  })()
  for (const h of bracketRecorded) recorded.add(h)

  /*
   * Count people, not spellings.
   *
   * The two sources spell the same person differently — the bracket writes `Xx_APOCALIPSYS_xX` where
   * the manifest has `xx_apocalypsys_xx` — so the union of their handles is one longer than the number
   * of players it names. Comparing that string count against a row count made a correct import look
   * one entrant short. Every handle is resolved to the Player it means and the distinct ones counted,
   * which is the same question the rest of this script asks.
   */
  const fromLegacyEarly = legacyRoster(season.competitionYear, season.number, season.division)
  const expectedPeople = new Set<string>()
  const unresolvedRecorded: string[] = []
  for (const h of recorded) {
    const id = await resolveCanonical(seasonId, h)
    if (id.resolution === 'resolved' && id.playerId) expectedPeople.add(id.playerId)
    else unresolvedRecorded.push(h)
  }
  const expectedTotal = expectedPeople.size + entrants.filter((e) => {
    if (!e.playerId || expectedPeople.has(e.playerId)) return false
    return fromLegacyEarly.has(legacyKey(String(e.cueverseId ?? e.username ?? '')))
  }).length
  check(`entrant count matches the archive (${expectedTotal})`,
    entrants.length === expectedTotal,
    `${entrants.length}${unresolvedRecorded.length ? `; ${unresolvedRecorded.length} recorded handle(s) resolve to nobody: ${unresolvedRecorded.slice(0, 4).join(', ')}` : ''}`)

  const playerIds = entrants.map((e) => e.playerId).filter(Boolean)
  check('no Player is entered twice', new Set(playerIds).size === playerIds.length)

  let unmatched = 0
  const entrantByPlayer = new Map(entrants.map((e) => [e.playerId, e]))
  for (const h of recorded) {
    const pid = await resolve(h)
    if (!pid || !entrantByPlayer.has(pid)) unmatched++
  }
  check('every recorded handle resolves to exactly one entrant', unmatched === 0, `${unmatched} unmatched`)

  /*
   * A stray is a PERSON the sources do not name, not a spelling they do not use.
   *
   * This compared the entrant's handle text against the recorded handles and then re-checked the
   * leftovers against their aliases as raw strings -- which cannot work, because aliases are stored
   * with their separators stripped. `expectedPeople` is already the set of Players the sources name,
   * resolved canonically a few lines above, so asking whether an entrant is in it is the same
   * question asked in the terms the rest of this file uses.
   */
  const fromLegacy = legacyRoster(season.competitionYear, season.number, season.division)
  let trueExtra = 0
  const strays: string[] = []
  for (const e of entrants) {
    if (!e.playerId || expectedPeople.has(e.playerId)) continue
    // Supported by the older export even when the newer manifest never names them.
    const spellings = [String(e.cueverseId ?? e.username ?? '')]
    const aliases = await prisma.playerAlias.findMany({ where: { playerId: e.playerId }, select: { alias: true } })
    spellings.push(...aliases.map((a) => a.alias))
    if (spellings.some((sp) => fromLegacy.has(legacyKey(sp)))) continue
    trueExtra++
    if (strays.length < 4) strays.push(String(e.cueverseId ?? e.username))
  }
  check('no entrant exists outside the archive record', trueExtra === 0,
    `${trueExtra} in neither the manifest, the page, nor the 8BRCAM export${strays.length ? `: ${strays.join(', ')}` : ''}`)
  check('no entrant is soft-withdrawn', (await prisma.seasonEntrant.count({ where: { seasonId, status: 'WITHDRAWN' } })) === 0)

  // ── Group membership ────────────────────────────────────────────────────────────────────────────
  const groups = await prisma.seasonGroup.findMany({
    where: { seasonId },
    select: { code: true, name: true, players: { select: { entrantId: true } } },
  })
  /*
   * The archive's groups, as sets of PEOPLE.
   *
   * Held as handle strings this compared one spelling against another and called a correctly placed
   * player misplaced whenever the two sources spelled them differently -- the same defect as the
   * stray check above. The handle set is kept as well, because the round-robin size below counts
   * positions in a group rather than people.
   */
  const wantGroups = new Map<string, Set<string>>()
  const wantGroupPeople = new Map<string, Set<string>>()
  for (const p of entry.participants) {
    const g = p.groupName
    if (!wantGroups.has(g)) { wantGroups.set(g, new Set()); wantGroupPeople.set(g, new Set()) }
    wantGroups.get(g)!.add(stripSourceNote(p.normalizedHandle).toLowerCase())
    const id = await resolveCanonical(seasonId, p.rawHandle)
    if (id.resolution === 'resolved' && id.playerId) wantGroupPeople.get(g)!.add(id.playerId)
  }
  check(`group count matches the archive (${wantGroups.size})`, groups.length === wantGroups.size, `${groups.length}`)

  const entrantById = new Map(entrants.map((e) => [e.id, e]))
  let misplaced = 0
  for (const g of groups) {
    const want = wantGroupPeople.get(g.name ?? g.code)
    if (!want) { misplaced += g.players.length; continue }
    for (const gp of g.players) {
      const e = entrantById.get(gp.entrantId)
      if (!e?.playerId || !want.has(e.playerId)) misplaced++
    }
  }
  check('every grouped player is in the group the archive lists', misplaced === 0, `${misplaced} misplaced`)

  // ── Schedule topology and results ───────────────────────────────────────────────────────────────
  const matches = await prisma.seasonMatch.findMany({
    where: { seasonId },
    select: { homeEntrantId: true, awayEntrantId: true, homeGames: true, awayGames: true, status: true },
  })
  const expectedFixtures = [...wantGroups.values()].reduce((a, s) => a + (s.size * (s.size - 1)) / 2, 0)
  check(`the schedule is a full round robin (${expectedFixtures} fixtures)`, matches.length === expectedFixtures, `${matches.length}`)

  const scored = matches.filter((m) => m.homeGames !== null && m.awayGames !== null)
  check(`every archived result was imported (${entry.matches.length})`, scored.length === entry.matches.length, `${scored.length}`)

  /*
   * Each archived score must sit on the fixture between the two people it was played by — a count
   * alone would pass even if every result landed on the wrong pair.
   */
  let wrongPair = 0, wrongScore = 0
  const keyOf = (a: number, b: number) => [a, b].sort((x, y) => x - y).join('-')
  const played = new Map<string, { h: number; a: number; hg: number; ag: number }>()
  for (const m of scored) played.set(keyOf(m.homeEntrantId, m.awayEntrantId), { h: m.homeEntrantId, a: m.awayEntrantId, hg: m.homeGames!, ag: m.awayGames! })

  for (const am of entry.matches) {
    const hp = await resolve(am.aRawHandle)
    const ap = await resolve(am.bRawHandle)
    const he = hp ? entrantByPlayer.get(hp) : undefined
    const ae = ap ? entrantByPlayer.get(ap) : undefined
    if (!he || !ae) { wrongPair++; continue }
    const row = played.get(keyOf(he.id, ae.id))
    if (!row) { wrongPair++; continue }
    const forward = row.h === he.id
    const gotHome = forward ? row.hg : row.ag
    const gotAway = forward ? row.ag : row.hg
    if (gotHome !== am.scoreA || gotAway !== am.scoreB) wrongScore++
  }
  check('every archived score sits on the fixture between the right two players', wrongPair === 0, `${wrongPair} missing`)
  check('every archived score has the archived value, the right way round', wrongScore === 0, `${wrongScore} differ`)

  // ── Standings ───────────────────────────────────────────────────────────────────────────────────
  const standings = await prisma.seasonStanding.findMany({
    where: { seasonId },
    select: { entrantId: true, wins: true, losses: true, draws: true, played: true, rank: true },
  })
  check('a standing exists for every grouped player', standings.length === groups.reduce((a, g) => a + g.players.length, 0), `${standings.length}`)

  const handleBySourceId = new Map(entry.participants.map((p) => [p.sourceId, p.rawHandle]))
  let winsDiffer = 0, standingUnmatched = 0
  for (const st of entry.standings) {
    const handle = handleBySourceId.get(st.sourceId)
    const pid = handle ? await resolve(handle) : null
    const e = pid ? entrantByPlayer.get(pid) : undefined
    const row = e ? standings.find((r) => r.entrantId === e.id) : undefined
    if (!row) { standingUnmatched++; continue }
    if (typeof st.wins === 'number' && row.wins !== st.wins) winsDiffer++
  }
  check('every archived standing row matches a recomputed one', standingUnmatched === 0, `${standingUnmatched} unmatched`)
  /*
   * Where the archive disagrees with itself, the disagreement is the assertion.
   *
   * The pages print both a standings table and a match table. For 2012 S1A they do not agree about
   * two players. Neither can be preferred without inventing a historical fact, so the reconstruction
   * recomputes standings from the matches it imported and records the archived claim beside them.
   *
   * Asserting agreement would have failed forever on a source defect. Asserting nothing would have
   * let a real regression hide behind a known one. So what is asserted is that any disagreement is a
   * KNOWN one — listed in the anomaly report — and that nothing was rewritten to paper over it.
   */
  const anomalyReportPath = 'reports/archive-source-anomalies.md'
  const anomalyText = sourceExists(anomalyReportPath) ? readSource(anomalyReportPath, 'utf8') : ''
  const anomalyLabel = `${season.competitionYear} S${season.number}${season.division ?? ''}`

  if (winsDiffer === 0) {
    check('recomputed wins agree with the archived standings', true)
  } else {
    check(`the standings disagreement is a recorded anomaly (${winsDiffer} player(s))`,
      anomalyText.includes(anomalyLabel) && /standings table/i.test(anomalyText),
      `${anomalyLabel} is not written up in ${anomalyReportPath}`)

    /*
     * And prove nothing was bent to fit. Every imported score still has to be the score the archive
     * printed for that pair — the check above already established that, and it is restated here so a
     * future edit cannot silently "fix" the standings by altering a match.
     */
    check('no match result was altered to reconcile the two tables', wrongScore === 0, `${wrongScore} differ`)
    check('the standings shown are the recomputed ones, not the archived claim', standings.length > 0)
    check('and the Season claims no ranking contribution it has not earned',
      String(season.lifecycleState) === 'COMPLETED' || (await prisma.ratingLedger.count({ where: { seasonId } })) === 0)
  }

  // ── Playoffs ────────────────────────────────────────────────────────────────────────────────────
  const included = entrants.filter((e) => e.playoffIncluded).length
  check(`the recorded playoff field is selected (${entry.playoff.participants.length})`,
    included === entry.playoff.participants.length, `${included}`)

  const bracket = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId }, select: { round: true, homeEntrantId: true, awayEntrantId: true, winnerEntrantId: true },
  })
  if (entry.playoff.placement === 'exact') {
    const r1 = bracket.filter((m) => m.round === 1)
    const seated = r1.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter(Boolean).length
    check(`every recorded Round 1 position is seated (${entry.playoff.participants.length})`,
      seated === entry.playoff.participants.length, `${seated}`)
    check(`the bracket is the size the archive records (${entry.playoff.bracketSize})`,
      r1.length * 2 === entry.playoff.bracketSize, `${r1.length * 2}`)
  } else {
    /*
     * An unrecorded topology may still be seated — from the archived bracket page.
     *
     * The season manifest records who played in a playoff and not where, but the Wayback capture
     * often does record the draw. So "the manifest says participants-only" no longer implies the
     * bracket must be empty; what it implies is that anything seated has to come from the page.
     */
    const fromPage = wayback && wayback.validation.category !== 'unusable'
    check('an unrecorded topology is only seated where the archived page records it',
      fromPage || bracket.every((m) => !m.homeEntrantId && !m.awayEntrantId) || bracket.length === 0,
      fromPage ? undefined : 'seated with no page to seat it from')
  }

  /*
   * Every playoff result must be one the archived page records.
   *
   * This used to assert that no playoff result existed at all, which was true only while none had
   * been imported. The guarantee worth keeping is not "no results" but "no invented results", so each
   * decided match is checked against the page: a score, a forfeit, or a bye is fine; anything else
   * would be a result this reconstruction made up.
   */
  const decided = bracket.filter((m) => m.winnerEntrantId)
  if (decided.length === 0) {
    check('no playoff result was invented', true)
  } else if (!wayback) {
    check('no playoff result was invented', false, `${decided.length} decided match(es) with no archived page`)
  } else {
    const provenByPage = wayback.matches.filter((m) => m.proven).length
    const byes = wayback.matches.filter((m) => m.bye).length
    check(`every decided match is one the page records (${decided.length})`,
      decided.length <= provenByPage + byes,
      `${decided.length} decided, ${provenByPage} proven and ${byes} bye(s) on the page`)

    /*
     * A forfeit row now stands for any match the page awarded rather than scored: a forfeit, a
     * disqualification, a walkover, or one the page never scored at all. They are separate facts and
     * the parser keeps them separate, but there is one way to record "the winner advanced and no games
     * were played", so this counts all of them.
     */
    const forfeits = await prisma.seasonPlayoffMatch.count({ where: { seasonId, forfeitEntrantId: { not: null } } })
    const pageForfeits = wayback.matches.filter((m) => isForfeitLike(m.outcome) && m.proven && !m.bye).length
    check(`every forfeit is one the page records (${forfeits})`, forfeits === pageForfeits,
      `${forfeits} recorded, ${pageForfeits} on the page`)
    check('no forfeit was awarded games',
      (await prisma.seasonPlayoffMatch.count({
        where: { seasonId, forfeitEntrantId: { not: null }, OR: [{ homeGames: { not: null } }, { awayGames: { not: null } }] },
      })) === 0)

    /*
     * A disqualification is recorded as a blocker, never as a result.
     *
     * The pages print DQ for nine matches. There is no disqualification outcome in this record, so
     * each must remain undecided — importing one would mean inventing a rule to fit an archive.
     */
    /*
     * A disqualification is now recorded — owner decision — so the invariant is no longer that it goes
     * unrecorded. It is that it never acquires a SCORE: the winner advances, and no games are credited
     * to anybody, because none were played. That is the part that would be a fabrication.
     */
    const dq = wayback.matches.filter((m) => m.outcome === 'disqualification')
    let dqScored = 0
    let dqUnforfeited = 0
    for (const m of dq) {
      const row = await prisma.seasonPlayoffMatch.findFirst({
        where: { seasonId, round: m.round, slot: m.position },
        select: { winnerEntrantId: true, homeGames: true, awayGames: true, forfeitEntrantId: true },
      })
      if (!row) continue
      if (row.homeGames !== null || row.awayGames !== null) dqScored++
      if (row.winnerEntrantId && !row.forfeitEntrantId) dqUnforfeited++
    }
    check(`no disqualification was given a score (${dq.length} on the page)`, dqScored === 0, `${dqScored} scored`)
    check('and each is recorded as an awarded match, not a played one', dqUnforfeited === 0, `${dqUnforfeited} without a forfeit`)
  }

  // ── Rankings boundary ───────────────────────────────────────────────────────────────────────────
  /*
   * The rankings boundary cuts both ways.
   *
   * An incomplete Season must contribute nothing — that is the guarantee these three checks were
   * written for. A completed one must contribute, and exactly once: asserting emptiness for every
   * Season would fail the moment a reconstruction genuinely finished one, which is the outcome the
   * whole exercise is for.
   */
  const ledgerRows = await prisma.ratingLedger.count({ where: { seasonId } })
  if (String(season.lifecycleState) === 'COMPLETED') {
    check('a completed Season contributes to Rankings', ledgerRows > 0, String(ledgerRows))
    check('a completed Season names its champion', Boolean(season.championName), String(season.championName))
    check('and carries exactly one ranking contribution', Boolean(season.ladderAppliedAt))

    /*
     * The champion has to be the player who actually won the Final, not merely somebody named.
     */
    const finalMatch = await prisma.seasonPlayoffMatch.findFirst({
      where: { seasonId, feedsMatchId: null },
      select: { winnerEntrantId: true },
      orderBy: { round: 'desc' },
    })
    check('the champion is the winner of the Final', Boolean(finalMatch?.winnerEntrantId))

    const titles = await prisma.season.count({ where: { id: seasonId, championName: { not: null } } })
    check('exactly one championship is recorded', titles === 1, String(titles))
  } else {
    check('an incomplete Season contributes nothing to Rankings', ledgerRows === 0, String(ledgerRows))
    check('no champion is claimed before a Final was played', !season.championName)
    check('no ranking contribution is stamped', !season.ladderAppliedAt)
  }

  const failed = checks.filter((c) => !c.ok).length
  return {
    seasonId,
    label: `${season.competitionYear} S${season.number}${season.division ?? ''}`,
    lifecycleState: String(season.lifecycleState),
    checks,
    passed: checks.length - failed,
    failed,
  }
}
