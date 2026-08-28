// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import '../_retired.mjs'

/**
 * archive:stage — read the READ-ONLY 8BRCAM archive and normalize it into
 * database-shaped staging JSON under data/staging/. Deterministic (no timestamps,
 * arrays sorted by stable id) so re-running produces byte-identical output.
 * Never writes to the archive or the database.
 */
import path from 'node:path'
import { readCsvObjects } from './lib/csv.mjs'
import { SOURCE_DIR, CORRECTIONS_DIR, STAGING_DIR, writeJson, byId } from './lib/io.mjs'
import {
  toInt,
  toBool,
  orNull,
  normalizeAlias,
  championConfidence,
  completenessConfidence,
} from './lib/normalize.mjs'

const PROV = 'IMPORTED_8BRCAM'
const read = (name, base = SOURCE_DIR) => readCsvObjects(path.join(base, name)).rows
const sdid = (season, division) => `${season}-${division}`

function main() {
  const sourceFiles = []
  const load = (name, base = SOURCE_DIR) => {
    const rows = read(name, base)
    sourceFiles.push({ stagingId: `src:${name}`, file: name, kind: 'archive-file', rows: rows.length })
    return rows
  }

  const playersRaw = load('players.csv')
  const aliasesRaw = load('player_aliases.csv')
  const seasonsRaw = load('seasons.csv')
  const divisionsRaw = load('season_divisions.csv')
  const groupsRaw = load('groups.csv')
  const standingsRaw = load('group_standings.csv')
  const groupMatchesRaw = load('group_matches.csv')
  const playoffsRaw = load('playoffs.csv')
  const playoffMatchesRaw = load('playoff_matches.csv')
  const seedsRaw = load('playoff_seeds.csv')
  const achievementsRaw = load('player_achievements.csv')
  const mergesRaw = load('player_merges.csv', CORRECTIONS_DIR)
  const splitsRaw = load('player_splits.csv', CORRECTIONS_DIR)

  const playerName = new Map(playersRaw.map((p) => [p.player_id, p.primary_name]))

  // ---- Players ----
  const players = playersRaw.map((p) => ({
    stagingId: `pl:${p.player_id}`,
    legacyPlayerId: p.player_id,
    primaryName: p.primary_name,
    country: orNull(p.country),
    firstYear: toInt(p.first_year),
    lastYear: toInt(p.last_year),
    primaryYm: orNull(p.primary_ym),
    primaryEmail: orNull(p.primary_email),
    nAliases: toInt(p.n_aliases),
    provenance: PROV,
    confidence: 'verified', // archive-canonical id already resolved
    reviewStatus: 'confirmed',
    source: { file: 'players.csv', row: p.__row },
  }))

  // ---- Competitors (one per player; Competitor supertype = PLAYER) ----
  const competitors = playersRaw.map((p) => ({
    stagingId: `co:${p.player_id}`,
    type: 'PLAYER',
    playerStagingId: `pl:${p.player_id}`,
    legacyPlayerId: p.player_id,
    provenance: PROV,
  }))

  // ---- Aliases ----
  const aliasCounter = new Map()
  const aliases = aliasesRaw.map((a) => {
    const n = (aliasCounter.get(a.player_id) || 0) + 1
    aliasCounter.set(a.player_id, n)
    return {
      stagingId: `al:${a.player_id}:${n}`,
      playerStagingId: `pl:${a.player_id}`,
      alias: a.alias,
      aliasRaw: a.alias,
      normalizedAlias: normalizeAlias(a.alias),
      aliasType: a.alias_type || 'HANDLE',
      provenance: PROV,
      source: { file: 'player_aliases.csv', row: a.__row },
    }
  })

  // ---- Competitions (one per season) ----
  const competitions = seasonsRaw.map((s) => ({
    stagingId: `cp:${s.season_id}`,
    legacyId: s.season_id,
    originalSeasonId: s.season_id,
    displayTitle: `${s.year} Season ${s.period}`,
    originalTitle: `8BRCAM ${s.season_id}`,
    type: 'Season',
    chronology: 'archive', // NEVER an EGO season
    year: toInt(s.year),
    period: orNull(s.period),
    era: orNull(s.era),
    status: 'completed',
    provenance: PROV,
    source: { file: 'seasons.csv', row: s.__row },
  }))
  const seasonIds = new Set(seasonsRaw.map((s) => s.season_id))

  // ---- Divisions ----
  const divisions = divisionsRaw.map((d) => ({
    stagingId: `dv:${d.season_division_id}`,
    legacyId: d.season_division_id,
    competitionStagingId: `cp:${d.season_id}`,
    seasonId: d.season_id,
    code: d.division,
    era: orNull(d.era),
    groupStatus: orNull(d.group_status),
    playoffStatus: orNull(d.playoff_status),
    completeness: orNull(d.completeness),
    confidence: completenessConfidence(d.completeness),
    notes: orNull(d.notes),
    provenance: PROV,
    source: { file: 'season_divisions.csv', row: d.__row },
  }))

  // ---- Playoffs indexed (for stages/championships) ----
  const playoffById = new Map(playoffsRaw.map((p) => [p.playoff_id, p]))

  // ---- Stages (derived: a GROUP stage where groups exist; a PLAYOFF stage where a playoff exists) ----
  const stages = []
  const divisionsWithGroups = new Set(groupsRaw.map((g) => sdid(g.season_id, g.division)))
  for (const id of divisionsWithGroups) {
    stages.push({
      stagingId: `st:${id}:group`,
      divisionStagingId: `dv:${id}`,
      competitionStagingId: `cp:${id.replace(/-[^-]+$/, '')}`,
      name: 'Group stage',
      stageFormat: 'GROUP',
      sequence: 1,
      provenance: PROV,
    })
  }
  for (const p of playoffsRaw) {
    stages.push({
      stagingId: `st:${p.playoff_id}:playoff`,
      divisionStagingId: `dv:${p.playoff_id}`,
      competitionStagingId: `cp:${p.season_id}`,
      playoffId: p.playoff_id,
      name: 'Playoffs',
      stageFormat: (p.format || 'single-elimination').toUpperCase().replace(/-/g, '_'),
      sequence: 2,
      provenance: PROV,
      source: { file: 'playoffs.csv', row: p.__row },
    })
  }

  // ---- Groups ----
  const groups = groupsRaw.map((g) => ({
    stagingId: `gr:${g.group_id}`,
    legacyId: g.group_id,
    stageStagingId: `st:${sdid(g.season_id, g.division)}:group`,
    competitionStagingId: `cp:${g.season_id}`,
    divisionCode: g.division,
    code: g.group_letter,
    scoreModel: orNull(g.score_model),
    provenance: PROV,
    source: { file: 'groups.csv', row: g.__row },
  }))

  // ---- Standings ----
  const standings = standingsRaw.map((r) => ({
    stagingId: `sd:${r.group_id}:${r.player_id}`,
    groupStagingId: `gr:${r.group_id}`,
    competitorStagingId: `co:${r.player_id}`,
    competitorRaw: r.player_id,
    slot: toInt(r.slot),
    played: toInt(r.played),
    wins: toInt(r.wins),
    losses: toInt(r.losses),
    draws: toInt(r.draws),
    gamesFor: toInt(r.games_for),
    gamesAgainst: toInt(r.games_against),
    points: toInt(r.points),
    provenance: PROV,
    source: { file: 'group_standings.csv', row: r.__row },
  }))

  // ---- Competition entries (distinct season+division+player from standings) ----
  const entryMap = new Map()
  for (const r of standingsRaw) {
    const key = `${r.season_id}:${r.division}:${r.player_id}`
    if (!entryMap.has(key)) {
      entryMap.set(key, {
        stagingId: `en:${key}`,
        competitionStagingId: `cp:${r.season_id}`,
        divisionStagingId: `dv:${sdid(r.season_id, r.division)}`,
        competitorStagingId: `co:${r.player_id}`,
        divisionCode: r.division,
        status: 'CONFIRMED',
        entryMethod: null, // unknown in archive — import decides
        provenance: PROV,
        source: { file: 'group_standings.csv', row: r.__row },
      })
    }
  }
  const entries = [...entryMap.values()]

  // ---- Seeds ----
  const seeds = seedsRaw.map((s) => ({
    stagingId: `se:${s.playoff_id}:${s.player_id || 'x' + s.__row}`,
    stageStagingId: `st:${s.playoff_id}:playoff`,
    competitorStagingId: s.player_id ? `co:${s.player_id}` : null,
    competitorRaw: orNull(s.player_id),
    seedNo: toInt(s.seed),
    handle: orNull(s.handle),
    provenance: PROV,
    source: { file: 'playoff_seeds.csv', row: s.__row },
  }))

  // ---- Matches (group + playoff) ----
  const groupMatches = groupMatchesRaw.map((m) => {
    const sa = toInt(m.score_a)
    const sb = toInt(m.score_b)
    return {
      stagingId: `ma:g:${m.match_id}`,
      kind: 'group',
      competitionStagingId: `cp:${m.season_id}`,
      divisionCode: m.division,
      stageStagingId: `st:${sdid(m.season_id, m.division)}:group`,
      groupStagingId: `gr:${m.group_id}`,
      competitorAStagingId: m.player_a_id ? `co:${m.player_a_id}` : null,
      competitorBStagingId: m.player_b_id ? `co:${m.player_b_id}` : null,
      competitorARaw: orNull(m.player_a_id),
      competitorBRaw: orNull(m.player_b_id),
      scoreA: sa,
      scoreB: sb,
      winnerCompetitorStagingId: m.winner_id ? `co:${m.winner_id}` : null,
      resolution: sa != null && sb != null ? 'played' : 'pending',
      provenance: PROV,
      confidence: 'verified',
      source: { file: 'group_matches.csv', row: m.__row },
      raw: { score_a: m.score_a, score_b: m.score_b, winner_id: m.winner_id, score_model: m.score_model },
    }
  })
  const playoffMatches = playoffMatchesRaw.map((m) => {
    const sc = (m.score || '').trim()
    const parts = sc.split('-')
    const sa = parts.length === 2 ? toInt(parts[0]) : null
    const sb = parts.length === 2 ? toInt(parts[1]) : null
    const hasB = !!m.player_b_id
    return {
      stagingId: `ma:p:${m.match_id}`,
      kind: 'playoff',
      competitionStagingId: `cp:${m.season_id}`,
      divisionCode: m.division,
      stageStagingId: `st:${m.playoff_id}:playoff`,
      playoffId: m.playoff_id,
      round: toInt(m.round),
      roundName: orNull(m.round_name),
      matchNo: toInt(m.match_no),
      competitorAStagingId: m.player_a_id ? `co:${m.player_a_id}` : null,
      competitorBStagingId: hasB ? `co:${m.player_b_id}` : null,
      competitorARaw: orNull(m.player_a_id),
      competitorBRaw: orNull(m.player_b_id),
      scoreA: sa,
      scoreB: sb,
      winnerCompetitorStagingId: m.winner_id ? `co:${m.winner_id}` : null,
      resolution: sa != null && sb != null ? 'played' : !hasB && m.player_a_id ? 'bye' : 'pending',
      provenance: PROV,
      confidence: sa != null ? 'verified' : 'incomplete',
      source: { file: 'playoff_matches.csv', row: m.__row },
      raw: { score: m.score, winner_id: m.winner_id, loser_id: m.loser_id },
    }
  })
  const matches = [...groupMatches, ...playoffMatches]

  // ---- Championships ----
  const championships = playoffsRaw.map((p) => ({
    stagingId: `ch:${p.playoff_id}`,
    competitionStagingId: `cp:${p.season_id}`,
    divisionStagingId: `dv:${p.playoff_id}`,
    stageStagingId: `st:${p.playoff_id}:playoff`,
    divisionCode: p.division,
    championCompetitorStagingId: p.champion_id ? `co:${p.champion_id}` : null,
    championRaw: orNull(p.champion_id),
    championHandle: orNull(p.champion_handle),
    runnerUpCompetitorStagingId: p.runner_up_id ? `co:${p.runner_up_id}` : null,
    runnerUpHandle: orNull(p.runner_up_handle),
    confidence: championConfidence(p.champion_confidence),
    confidenceRaw: orNull(p.champion_confidence),
    bracketReconstructed: toBool(p.bracket_reconstructed),
    decidingMatchStagingId: null, // playoff match results not recorded in archive
    provenance: PROV,
    reviewStatus: championConfidence(p.champion_confidence) === 'explicit' ? 'confirmed' : 'review',
    source: { file: 'playoffs.csv', row: p.__row },
    raw: {
      champion_id: p.champion_id,
      champion_handle: p.champion_handle,
      champion_confidence: p.champion_confidence,
      bracket_reconstructed: p.bracket_reconstructed,
    },
  }))

  // ---- Achievements ----
  const achievements = achievementsRaw.map((a) => ({
    stagingId: `ac:${a.achievement_id}`,
    legacyId: a.achievement_id,
    playerStagingId: `pl:${a.player_id}`,
    code: a.code,
    label: a.label,
    competitionStagingId: a.season_id ? `cp:${a.season_id}` : null,
    divisionCode: orNull(a.division),
    value: orNull(a.value),
    provenance: PROV,
    source: { file: 'player_achievements.csv', row: a.__row },
  }))

  // ---- Identity relationships (existing merges/splits — PRESERVED) ----
  const identityRelationships = [
    ...mergesRaw.map((m, i) => ({
      stagingId: `idr:merge:${i + 1}`,
      type: 'merge',
      canonicalPlayerStagingId: `pl:${m.canonical_player_id}`,
      mergedPlayerStagingId: `pl:${m.merged_player_id}`,
      note: orNull(m.note),
      status: 'APPROVED',
      decision: 'existing',
      source: { file: 'player_merges.csv', row: m.__row },
    })),
    ...splitsRaw.map((s, i) => ({
      stagingId: `idr:split:${i + 1}`,
      type: 'split',
      sourcePlayerStagingId: `pl:${s.source_player_id}`,
      newPlayerStagingId: `pl:${s.new_player_id}`,
      seasonId: orNull(s.season_id),
      divisionCode: orNull(s.division),
      newPrimaryName: orNull(s.new_primary_name),
      note: orNull(s.note),
      status: 'APPROVED',
      decision: 'existing',
      source: { file: 'player_splits.csv', row: s.__row },
    })),
  ]

  // ---- Source references (higher-level entities; matches carry inline source) ----
  const sourceReferences = [
    ...players.map((p) => ({
      stagingId: `sr:${p.stagingId}`,
      targetType: 'PLAYER',
      targetStagingId: p.stagingId,
      kind: 'FILE_ROW',
      locator: `players.csv:${p.source.row}`,
      confidence: 'verified',
    })),
    ...divisions.map((d) => ({
      stagingId: `sr:${d.stagingId}`,
      targetType: 'DIVISION',
      targetStagingId: d.stagingId,
      kind: 'FILE_ROW',
      locator: `season_divisions.csv:${d.source.row}`,
      confidence: d.confidence,
    })),
    ...championships.map((c) => ({
      stagingId: `sr:${c.stagingId}`,
      targetType: 'CHAMPIONSHIP',
      targetStagingId: c.stagingId,
      kind: 'FILE_ROW',
      locator: `playoffs.csv:${c.source.row}`,
      confidence: c.confidence,
    })),
  ]

  // ---- Historical notes / administrative annotations ----
  const historicalNotes = [
    {
      stagingId: 'note:ego-s1-seeding',
      type: 'historical-discrepancy',
      scope: 'EGO Season 1 (legacy 8B Retro Season 1)',
      title: 'EGO Season 1 playoff seeding — administrative annotation',
      officialRecord: 'Preserved as recorded. No official bracket has been rewritten and no corrected bracket generated.',
      claim:
        'User-supplied testimony: the head administrator at the time may have mis-assigned the playoff seeding, so the published seeding may not have followed the intended qualification order.',
      evidence: { sourceVerified: false, userTestimony: true },
      status: 'unresolved',
      resolution:
        'No 8B Retro Season 1 source data is present in the local 8BRCAM archive to verify or refute this. Treat as an administrative annotation, not a results correction.',
      appliesToStaging: false,
    },
    {
      stagingId: 'note:playoff-results-missing',
      type: 'data-completeness',
      scope: '8BRCAM archive (all seasons)',
      title: 'Playoff match results not recorded',
      officialRecord:
        'Playoff seedings and first-round pairings survive; individual playoff match scores/progression were not recorded.',
      evidence: { sourceVerified: true, userTestimony: false },
      status: 'known-limitation',
      resolution: 'Do not invent missing playoff progression or scores. Champions are recorded separately with their own confidence.',
      appliesToStaging: true,
    },
  ]

  // ---- Write staging (deterministic) ----
  const out = {
    'sources.json': byId(sourceFiles),
    'players.json': byId(players),
    'competitors.json': byId(competitors),
    'aliases.json': byId(aliases),
    'competitions.json': byId(competitions),
    'divisions.json': byId(divisions),
    'stages.json': byId(stages),
    'groups.json': byId(groups),
    'standings.json': byId(standings),
    'entries.json': byId(entries),
    'seeds.json': byId(seeds),
    'matches.json': byId(matches),
    'championships.json': byId(championships),
    'achievements.json': byId(achievements),
    'identity-relationships.json': byId(identityRelationships),
    'source-references.json': byId(sourceReferences),
    'historical-notes.json': byId(historicalNotes),
  }
  for (const [name, data] of Object.entries(out)) writeJson(STAGING_DIR, name, data)

  const counts = {
    sourceFiles: sourceFiles.length,
    players: players.length,
    competitors: competitors.length,
    aliases: aliases.length,
    competitions: competitions.length,
    divisions: divisions.length,
    stages: stages.length,
    groups: groups.length,
    standings: standings.length,
    entries: entries.length,
    seeds: seeds.length,
    matches: matches.length,
    groupMatches: groupMatches.length,
    playoffMatches: playoffMatches.length,
    championships: championships.length,
    achievements: achievements.length,
    identityRelationships: identityRelationships.length,
    sourceReferences: sourceReferences.length,
    historicalNotes: historicalNotes.length,
  }
  writeJson(STAGING_DIR, 'manifest.json', { source: 'read-only 8BRCAM archive', sourceFiles, counts, note: 'Deterministic snapshot; safe to regenerate. Not imported to the database.' })

  console.log('archive:stage complete →', STAGING_DIR)
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`)
}

main()
