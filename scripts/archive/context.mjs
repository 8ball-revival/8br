/**
 * archive:context — precompute rich, DETERMINISTIC per-issue review context and
 * evidence SIGNALS (not conclusions) into reports/archive/review-context.json.
 * Read by the dashboard and the review-packet exporter. No timestamps; read-only.
 */
import path from 'node:path'
import { STAGING_DIR, REPORTS_DIR, SOURCE_DIR, readJson, writeJson } from './lib/io.mjs'
import { readCsvObjects } from './lib/csv.mjs'
import { nameKey } from './lib/normalize.mjs'

const load = (n) => readJson(STAGING_DIR, n)
const issueId = (type, ref) => `${type}::${ref}`
const cap = (arr, n) => arr.slice(0, n)

function main() {
  const players = load('players.json')
  const aliases = load('aliases.json')
  const entries = load('entries.json')
  const matches = load('matches.json')
  const championships = load('championships.json')
  const identity = load('identity-relationships.json')
  const reviewQueue = readJson(REPORTS_DIR, 'review-queue.json')
  const achievements = readCsvObjects(path.join(SOURCE_DIR, 'player_achievements.csv')).rows

  const playerBy = new Map(players.map((p) => [p.stagingId, p]))
  const aliasesByPlayer = new Map()
  for (const a of aliases) {
    const arr = aliasesByPlayer.get(a.playerStagingId) || []
    arr.push(a.alias)
    aliasesByPlayer.set(a.playerStagingId, arr)
  }
  // competitions (seasons) per competitor
  const seasonsByCompetitor = new Map()
  for (const e of entries) {
    const s = seasonsByCompetitor.get(e.competitorStagingId) || new Set()
    s.add(e.competitionStagingId.replace(/^cp:/, ''))
    seasonsByCompetitor.set(e.competitorStagingId, s)
  }
  // match tallies per competitor
  const tally = new Map()
  const bump = (id, w) => {
    if (!id) return
    const t = tally.get(id) || { matches: 0, wins: 0 }
    t.matches++
    if (w) t.wins++
    tally.set(id, t)
  }
  const matchBy = new Map(matches.map((m) => [m.stagingId, m]))
  for (const m of matches) {
    const win = m.winnerCompetitorStagingId
    bump(m.competitorAStagingId, win && win === m.competitorAStagingId)
    bump(m.competitorBStagingId, win && win === m.competitorBStagingId)
  }
  // championships per competitor (as champion / runner-up)
  const titlesByCompetitor = new Map()
  for (const c of championships) {
    for (const [cid, result] of [
      [c.championCompetitorStagingId, 'champion'],
      [c.runnerUpCompetitorStagingId, 'runner-up'],
    ]) {
      if (!cid) continue
      const arr = titlesByCompetitor.get(cid) || []
      arr.push({ competition: c.competitionStagingId.replace(/^cp:/, ''), division: c.divisionCode, result, confidence: c.confidence })
      titlesByCompetitor.set(cid, arr)
    }
  }
  const mergesByPlayer = new Map()
  const splitsByPlayer = new Map()
  for (const r of identity) {
    if (r.type === 'merge') {
      for (const pid of [r.canonicalPlayerStagingId, r.mergedPlayerStagingId]) {
        const arr = mergesByPlayer.get(pid) || []
        arr.push(r)
        mergesByPlayer.set(pid, arr)
      }
    } else if (r.type === 'split') {
      for (const pid of [r.sourcePlayerStagingId, r.newPlayerStagingId]) {
        const arr = splitsByPlayer.get(pid) || []
        arr.push(r)
        splitsByPlayer.set(pid, arr)
      }
    }
  }
  // explicit CHAMPION achievements by season-division
  const champAchByDiv = new Map()
  for (const a of achievements) {
    if ((a.code || '').toUpperCase() === 'CHAMPION') {
      const k = `${a.season_id}-${a.division}`
      const s = champAchByDiv.get(k) || new Set()
      s.add(a.player_id)
      champAchByDiv.set(k, s)
    }
  }
  // playoff ids that have any match / any played match
  const playoffHasMatch = new Set(matches.filter((m) => m.kind === 'playoff').map((m) => m.playoffId))
  const playoffHasPlayed = new Set(matches.filter((m) => m.kind === 'playoff' && m.scoreA != null).map((m) => m.playoffId))
  // preview player legacy ids (counts-in-preview)
  let previewLegacy = new Set()
  try {
    previewLegacy = new Set(readJson(path.join(process.cwd(), 'src/lib/preview-data'), 'archive-players.json').map((p) => p.playerId))
  } catch {
    /* ignore */
  }

  function playerContext(competitorStagingId) {
    const legacy = competitorStagingId.replace(/^co:/, '')
    const p = playerBy.get(`pl:${legacy}`) || {}
    const seasons = [...(seasonsByCompetitor.get(competitorStagingId) || [])].sort()
    const t = tally.get(competitorStagingId) || { matches: 0, wins: 0 }
    const titles = titlesByCompetitor.get(competitorStagingId) || []
    return {
      canonicalId: legacy,
      primaryName: p.primaryName || legacy,
      aliases: cap(aliasesByPlayer.get(`pl:${legacy}`) || [], 12),
      aliasCount: (aliasesByPlayer.get(`pl:${legacy}`) || []).length,
      competitions: cap(seasons, 12),
      competitionCount: seasons.length,
      firstYear: p.firstYear ?? null,
      lastYear: p.lastYear ?? null,
      matches: t.matches,
      wins: t.wins,
      championships: titles.filter((x) => x.result === 'champion').length,
      runnerUps: titles.filter((x) => x.result === 'runner-up').length,
      titleRecords: cap(titles, 8),
      ym: p.primaryYm || null,
      email: p.primaryEmail || null,
      existingMerges: (mergesByPlayer.get(`pl:${legacy}`) || []).length,
      existingSplits: (splitsByPlayer.get(`pl:${legacy}`) || []).length,
      source: p.source || null,
    }
  }

  function identitySignals(ctxs) {
    const signals = []
    const yms = ctxs.map((c) => c.ym).filter(Boolean)
    const emails = ctxs.map((c) => c.email).filter(Boolean)
    if (new Set(yms).size < yms.length && yms.length > 1) signals.push('matching_ym')
    if (new Set(emails).size < emails.length && emails.length > 1) signals.push('matching_email')
    // overlapping seasons?
    const seasonSets = ctxs.map((c) => new Set(c.competitions))
    let overlap = false
    for (let i = 0; i < seasonSets.length; i++)
      for (let j = i + 1; j < seasonSets.length; j++)
        if ([...seasonSets[i]].some((s) => seasonSets[j].has(s))) overlap = true
    signals.push(overlap ? 'overlapping_active_seasons' : 'non_overlapping_usage')
    if (ctxs.some((c) => c.existingMerges > 0)) signals.push('existing_merge_evidence')
    if (ctxs.some((c) => c.existingSplits > 0)) signals.push('existing_split_evidence')
    // name similarity only (all same name key, no other strong signal)
    const sameName = new Set(ctxs.map((c) => nameKey(c.primaryName))).size === 1
    if (sameName && !signals.includes('matching_ym') && !signals.includes('matching_email')) signals.push('name_similarity_only')
    return signals
  }

  function matchDiagnostics(m) {
    const diag = []
    const missing = !m.competitorAStagingId || !m.competitorBStagingId
    if (missing) diag.push('bye_or_walkover_candidate')
    if (m.scoreA == null || m.scoreB == null) diag.push('missing_score')
    if (m.scoreA != null && m.scoreB != null) {
      if (m.scoreA === m.scoreB && m.winnerCompetitorStagingId) diag.push('possible_forfeit_or_admin_ruling')
      if (m.winnerCompetitorStagingId) {
        const winA = m.winnerCompetitorStagingId === m.competitorAStagingId
        const winB = m.winnerCompetitorStagingId === m.competitorBStagingId
        if ((winA && m.scoreA < m.scoreB) || (winB && m.scoreB < m.scoreA)) {
          diag.push('winner_field_may_be_reversed')
          diag.push('score_may_be_reversed')
        }
      }
    }
    if (m.kind === 'playoff' && m.scoreA == null && !missing) diag.push('unclear_legacy_format')
    return diag
  }

  const out = {}

  for (const it of reviewQueue) {
    if (['shared-alias', 'name-duplicate', 'merge-candidate'].includes(it.type)) {
      const ids = it.detail?.players || []
      const ctxs = ids.map((id) => playerContext(id.replace(/^pl:/, 'co:')))
      out[issueId(it.type, it.ref)] = {
        kind: 'identity',
        value: it.type === 'merge-candidate' ? it.detail?.value : it.ref,
        players: ctxs,
        signals: identitySignals(ctxs),
      }
    } else if (it.type === 'match') {
      const m = matchBy.get(it.ref)
      if (!m) {
        out[issueId(it.type, it.ref)] = { kind: 'match', missing: true }
        continue
      }
      const scoreImpliedWinner =
        m.scoreA != null && m.scoreB != null && m.scoreA !== m.scoreB
          ? m.scoreA > m.scoreB
            ? m.competitorAStagingId
            : m.competitorBStagingId
          : null
      out[issueId(it.type, it.ref)] = {
        kind: 'match',
        competition: m.competitionStagingId,
        division: m.divisionCode,
        stage: m.stageStagingId,
        group: m.groupStagingId || null,
        round: m.roundName || null,
        competitorA: playerBy.get(`pl:${(m.competitorARaw || '')}`)?.primaryName || m.competitorARaw || null,
        competitorB: playerBy.get(`pl:${(m.competitorBRaw || '')}`)?.primaryName || m.competitorBRaw || null,
        competitorARaw: m.competitorARaw,
        competitorBRaw: m.competitorBRaw,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        recordedWinnerRaw: m.raw?.winner_id || null,
        scoreImpliedWinnerRaw: scoreImpliedWinner ? scoreImpliedWinner.replace(/^co:/, '') : null,
        resolution: m.resolution,
        source: m.source,
        raw: m.raw,
        missingCompetitor: !m.competitorAStagingId || !m.competitorBStagingId,
        diagnostics: matchDiagnostics(m),
      }
    } else if (it.type === 'championship') {
      const c = championships.find((x) => x.stagingId === it.ref)
      if (!c) continue
      const pid = c.competitionStagingId.replace(/^cp:/, '')
      const divKey = `${pid}-${c.divisionCode}`
      const ach = champAchByDiv.get(divKey) || new Set()
      const playoffId = c.stagingId.replace(/^ch:/, '')
      out[issueId(it.type, it.ref)] = {
        kind: 'championship',
        competition: pid,
        division: c.divisionCode,
        champion: playerBy.get(`pl:${c.championRaw}`)?.primaryName || c.championHandle || c.championRaw,
        championRaw: c.championRaw,
        confidence: c.confidence,
        confidenceRaw: c.confidenceRaw,
        source: c.source,
        playoffRecordsSurvive: playoffHasMatch.has(playoffId),
        decidingMatchSurvives: playoffHasPlayed.has(playoffId),
        supportingAchievements: c.championRaw && ach.has(c.championRaw),
        conflictingCandidates: [...ach].filter((x) => x !== c.championRaw),
        countsInPreview: c.championRaw ? previewLegacy.has(c.championRaw) : false,
      }
    }
  }

  writeJson(REPORTS_DIR, 'review-context.json', out)
  console.log('archive:context complete →', path.join(REPORTS_DIR, 'review-context.json'))
  console.log('  issues with context:', Object.keys(out).length)
}

main()
