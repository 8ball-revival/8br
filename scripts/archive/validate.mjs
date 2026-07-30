/**
 * archive:validate — read data/staging and detect identity/competition/match/
 * championship issues. Writes validation-summary.json and review-queue.json to
 * reports/archive/. Never auto-resolves conflicts or invents values. Deterministic.
 */
import { readCsvObjects } from './lib/csv.mjs'
import path from 'node:path'
import { STAGING_DIR, REPORTS_DIR, SOURCE_DIR, readJson, writeJson, byId } from './lib/io.mjs'
import { nameKey } from './lib/normalize.mjs'

const load = (name) => readJson(STAGING_DIR, name)

function main() {
  const players = load('players.json')
  const competitors = load('competitors.json')
  const aliases = load('aliases.json')
  const competitions = load('competitions.json')
  const divisions = load('divisions.json')
  const groups = load('groups.json')
  const standings = load('standings.json')
  const seeds = load('seeds.json')
  const matches = load('matches.json')
  const championships = load('championships.json')
  const identity = load('identity-relationships.json')
  const manifest = load('manifest.json')

  const competitorIds = new Set(competitors.map((c) => c.stagingId))
  const groupIds = new Set(groups.map((g) => g.stagingId))
  const playerById = new Map(players.map((p) => [p.stagingId, p]))
  const reviewQueue = []
  const q = (type, ref, reason, severity, detail) =>
    reviewQueue.push({ type, ref, reason, severity, detail: detail ?? null })

  // ---------------- Identity resolution ----------------
  const merges = identity.filter((i) => i.type === 'merge')
  const splits = identity.filter((i) => i.type === 'split')

  // shared aliases: same normalized alias → >1 distinct player
  const aliasByNorm = new Map()
  let exactAlias = 0
  let normalizedAlias = 0
  for (const a of aliases) {
    const owner = playerById.get(a.playerStagingId)
    if (owner && nameKey(a.alias) === nameKey(owner.primaryName)) exactAlias++
    else normalizedAlias++
    if (!a.normalizedAlias) continue
    const set = aliasByNorm.get(a.normalizedAlias) || new Set()
    set.add(a.playerStagingId)
    aliasByNorm.set(a.normalizedAlias, set)
  }
  const sharedAliases = []
  for (const [norm, set] of aliasByNorm) {
    if (set.size > 1) {
      sharedAliases.push({ normalizedAlias: norm, players: [...set].sort() })
      q('shared-alias', norm, 'Alias resolves to more than one canonical player', 'high', {
        players: [...set].sort(),
      })
    }
  }

  // merge candidates: distinct players sharing a YM or email, not already merged
  const mergedPairs = new Set(
    merges.map((m) => [m.canonicalPlayerStagingId, m.mergedPlayerStagingId].sort().join('|')),
  )
  const cluster = (field) => {
    const by = new Map()
    for (const p of players) {
      const v = p[field]
      if (!v) continue
      const arr = by.get(v) || []
      arr.push(p.stagingId)
      by.set(v, arr)
    }
    return [...by.entries()].filter(([, ids]) => ids.length > 1)
  }
  const mergeCandidates = []
  for (const [signal, kind] of [
    ['primaryYm', 'shared-ym'],
    ['primaryEmail', 'shared-email'],
  ]) {
    for (const [value, ids] of cluster(signal)) {
      const sorted = [...ids].sort()
      // only flag if not fully covered by an existing merge
      const key = sorted.slice(0, 2).join('|')
      if (mergedPairs.has(key)) continue
      mergeCandidates.push({ signal: kind, value, players: sorted })
      q('merge-candidate', value, `Distinct players share ${kind}`, 'medium', { players: sorted })
    }
  }

  // probable name-only duplicates (LOW confidence — never auto-merge)
  const byNameKey = new Map()
  for (const p of players) {
    const k = nameKey(p.primaryName)
    const arr = byNameKey.get(k) || []
    arr.push(p.stagingId)
    byNameKey.set(k, arr)
  }
  const nameDuplicates = [...byNameKey.entries()].filter(([, ids]) => ids.length > 1)
  for (const [k, ids] of nameDuplicates) {
    q('name-duplicate', k, 'Multiple players share a normalized display name (name-only — do NOT merge on this alone)', 'low', {
      players: [...ids].sort(),
    })
  }

  // unresolved: orphan aliases / players missing name
  const playerIds = new Set(players.map((p) => p.stagingId))
  const orphanAliases = aliases.filter((a) => !playerIds.has(a.playerStagingId))
  const missingName = players.filter((p) => !p.primaryName || !p.primaryName.trim())
  orphanAliases.forEach((a) => q('unresolved-alias', a.stagingId, 'Alias references a missing player', 'high'))
  missingName.forEach((p) => q('unresolved-player', p.stagingId, 'Player has no primary name', 'high'))

  const identityReport = {
    confirmedCanonical: players.length,
    exactAliasMatches: exactAlias,
    normalizedAliasMatches: normalizedAlias,
    existingMerges: merges.length,
    existingSplits: splits.length,
    sharedAliases: sharedAliases.length,
    mergeCandidates: mergeCandidates.length,
    nameOnlyDuplicateGroups: nameDuplicates.length,
    unresolvedAliases: orphanAliases.length,
    unresolvedPlayers: missingName.length,
  }

  // ---------------- Competition validation ----------------
  const byCompleteness = {}
  const byConfidence = {}
  const competitionIssues = []
  for (const d of divisions) {
    byCompleteness[d.completeness || 'unknown'] = (byCompleteness[d.completeness || 'unknown'] || 0) + 1
    byConfidence[d.confidence] = (byConfidence[d.confidence] || 0) + 1
    if (d.completeness === 'missing') {
      competitionIssues.push({ division: d.stagingId, issue: 'completeness missing' })
      q('competition', d.stagingId, 'Division completeness = missing', 'medium')
    }
    if (d.groupStatus === 'missing') competitionIssues.push({ division: d.stagingId, issue: 'group data missing' })
    if (d.playoffStatus === 'missing') competitionIssues.push({ division: d.stagingId, issue: 'playoff data missing' })
  }
  const nonArchive = competitions.filter((c) => c.chronology !== 'archive')
  const competitionReport = {
    competitions: competitions.length,
    divisions: divisions.length,
    byCompleteness,
    byConfidence,
    issues: competitionIssues.length,
    labeledAsEgoSeason: nonArchive.length, // must be 0
  }

  // ---------------- Match validation ----------------
  let withScore = 0
  let missingScore = 0
  let byes = 0
  let missingCompetitor = 0
  let unresolvedCompetitor = 0
  let impossibleScore = 0
  const resolutionCounts = {}
  const seen = new Set()
  let duplicates = 0
  let adminUnclear = 0
  for (const m of matches) {
    resolutionCounts[m.resolution] = (resolutionCounts[m.resolution] || 0) + 1
    if (m.scoreA != null && m.scoreB != null) withScore++
    else missingScore++
    if (m.resolution === 'bye') byes++
    // missing competitor (excluding intentional byes)
    if ((!m.competitorAStagingId || !m.competitorBStagingId) && m.resolution !== 'bye') {
      missingCompetitor++
      if (m.kind === 'group') q('match', m.stagingId, 'Group match missing a competitor', 'high')
    }
    // unresolved competitor (id not in competitors set)
    for (const cid of [m.competitorAStagingId, m.competitorBStagingId, m.winnerCompetitorStagingId]) {
      if (cid && !competitorIds.has(cid)) {
        unresolvedCompetitor++
        q('match', m.stagingId, `Match references unknown competitor ${cid}`, 'high')
      }
    }
    // group membership consistency
    if (m.groupStagingId && !groupIds.has(m.groupStagingId)) {
      q('match', m.stagingId, `Match references unknown group ${m.groupStagingId}`, 'high')
    }
    // impossible / suspicious scores
    if (m.scoreA != null && m.scoreB != null) {
      if (m.scoreA < 0 || m.scoreB < 0) {
        impossibleScore++
        q('match', m.stagingId, 'Negative score', 'high')
      } else if (m.winnerCompetitorStagingId) {
        const winA = m.winnerCompetitorStagingId === m.competitorAStagingId
        const winB = m.winnerCompetitorStagingId === m.competitorBStagingId
        if (m.scoreA === m.scoreB) {
          adminUnclear++
          q('match', m.stagingId, 'Winner recorded but scores equal (possible forfeit/administrative)', 'low')
        } else if ((winA && m.scoreA < m.scoreB) || (winB && m.scoreB < m.scoreA)) {
          impossibleScore++
          q('match', m.stagingId, 'Winner does not match the higher score', 'high')
        }
      }
    }
    // duplicate detection (unordered pair within same stage)
    if (m.competitorAStagingId && m.competitorBStagingId) {
      const pair = [m.competitorAStagingId, m.competitorBStagingId].sort().join('|')
      const key = `${m.stageStagingId}|${pair}`
      if (seen.has(key)) {
        duplicates++
        q('match', m.stagingId, 'Duplicate pairing within the same stage', 'medium')
      } else seen.add(key)
    }
  }
  // seed consistency
  const seedByPlayoff = new Map()
  let seedDupNo = 0
  let seedNullCompetitor = 0
  for (const s of seeds) {
    if (!s.competitorStagingId) {
      seedNullCompetitor++
      continue
    }
    const set = seedByPlayoff.get(s.stageStagingId) || new Map()
    set.set(s.seedNo, (set.get(s.seedNo) || 0) + 1)
    seedByPlayoff.set(s.stageStagingId, set)
  }
  for (const [, m] of seedByPlayoff) for (const [, cnt] of m) if (cnt > 1) seedDupNo++

  const matchReport = {
    total: matches.length,
    groupMatches: matches.filter((m) => m.kind === 'group').length,
    playoffMatches: matches.filter((m) => m.kind === 'playoff').length,
    withScore,
    missingScore,
    byes,
    byResolution: resolutionCounts,
    missingCompetitor,
    unresolvedCompetitor,
    impossibleScore,
    duplicates,
    adminOrForfeitUnclear: adminUnclear,
    seedDuplicateNumbers: seedDupNo,
    seedNullCompetitor,
  }
  // Summarize the large known limitation once (not per-row)
  const missingPlayoffScores = matches.filter((m) => m.kind === 'playoff' && m.scoreA == null).length
  if (missingPlayoffScores > 0) {
    q('data-completeness', 'playoff-scores', `${missingPlayoffScores} playoff matches have no recorded score (known archive limitation — do not invent)`, 'info', {
      count: missingPlayoffScores,
    })
  }

  // ---------------- Championship validation ----------------
  // conflict check against CHAMPION achievements
  const achievements = readCsvObjects(path.join(SOURCE_DIR, 'player_achievements.csv')).rows
  const champByDiv = new Map() // season-division -> Set(player_id) explicitly labelled CHAMPION
  for (const a of achievements) {
    if ((a.code || '').toUpperCase() === 'CHAMPION') {
      const k = `${a.season_id}-${a.division}`
      const set = champByDiv.get(k) || new Set()
      set.add(a.player_id)
      champByDiv.set(k, set)
    }
  }
  const champConf = {}
  let decidingMatchSurvives = 0
  let conflicts = 0
  let reconstructed = 0
  const playoffHasPlayed = new Set(
    matches.filter((m) => m.kind === 'playoff' && m.scoreA != null).map((m) => m.playoffId),
  )
  for (const c of championships) {
    champConf[c.confidence] = (champConf[c.confidence] || 0) + 1
    if (c.bracketReconstructed) reconstructed++
    const playoffId = c.stagingId.replace(/^ch:/, '')
    if (playoffHasPlayed.has(playoffId)) decidingMatchSurvives++
    // conflict: explicit CHAMPION achievement disagrees with playoffs champion
    const k = `${c.divisionStagingId.replace(/^dv:/, '')}`
    const labelled = champByDiv.get(k)
    if (labelled && c.championRaw && !labelled.has(c.championRaw)) {
      conflicts++
      q('championship', c.stagingId, 'Champion conflicts with an explicit CHAMPION achievement', 'high', {
        playoffChampion: c.championRaw,
        achievementChampions: [...labelled],
      })
    }
    if (c.reviewStatus === 'review') {
      q('championship', c.stagingId, `Champion confidence = ${c.confidence} (not explicit) — do not promote to verified`, 'medium')
    }
  }
  const championshipReport = {
    total: championships.length,
    byConfidence: champConf,
    reconstructedBrackets: reconstructed,
    decidingMatchSurvives,
    conflicts,
    requiresReview: championships.filter((c) => c.reviewStatus === 'review').length,
  }

  // ---------------- Import readiness ----------------
  const blockers = [] // genuine schema blockers (none expected)
  const highSeverity = reviewQueue.filter((r) => r.severity === 'high').length
  const requiresReview = reviewQueue.filter((r) => r.severity !== 'info').length
  const importReadiness = {
    schemaBlockers: blockers,
    highSeverityIssues: highSeverity,
    itemsRequiringReview: requiresReview,
    recordsSafeToImportEstimate:
      manifest.counts.matches + manifest.counts.players + manifest.counts.competitions - highSeverity,
    readyForReviewedImport: blockers.length === 0,
  }

  const summary = {
    counts: manifest.counts,
    identity: identityReport,
    competitions: competitionReport,
    matches: matchReport,
    championships: championshipReport,
    importReadiness,
    reviewQueueSize: reviewQueue.length,
  }

  writeJson(REPORTS_DIR, 'validation-summary.json', summary)
  writeJson(REPORTS_DIR, 'review-queue.json', byId(reviewQueue.map((r, i) => ({ stagingId: `rq:${String(i + 1).padStart(5, '0')}`, ...r }))))

  console.log('archive:validate complete →', REPORTS_DIR)
  console.log('  identity:', JSON.stringify(identityReport))
  console.log('  competitions:', JSON.stringify(competitionReport))
  console.log('  matches:', JSON.stringify(matchReport))
  console.log('  championships:', JSON.stringify(championshipReport))
  console.log('  reviewQueue:', reviewQueue.length, '| high severity:', highSeverity)
  console.log('  schema blockers:', blockers.length)
}

main()
