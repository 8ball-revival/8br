/**
 * archive:apply-reviews — derive data/reviewed-staging/ from data/staging/ by
 * applying ONLY approved/resolved review decisions. Never overwrites data/staging/.
 * Preserves original values + provenance (adds `review` fields; originals untouched).
 * Deterministic & idempotent (no timestamps; decision ref = issueId@vN). Also emits
 * the review reports.
 */
import fs from 'node:fs'
import path from 'node:path'
import { STAGING_DIR, REPORTS_DIR, REPO_ROOT, readJson, writeJson, writeText } from './lib/io.mjs'
import { readDecisions, readHistory, issueIdOf } from './lib/decisions.mjs'
import cfg from './review-config.json' with { type: 'json' }

const REVIEWED_DIR = path.join(REPO_ROOT, 'data', 'reviewed-staging')
const applied = (status) => cfg.appliedStatuses.includes(status)
const decisionRef = (d) => `${d.issueId}@v${d.version}`

function loadStagingAll() {
  const files = fs.readdirSync(STAGING_DIR).filter((f) => f.endsWith('.json'))
  const data = {}
  for (const f of files) data[f] = readJson(STAGING_DIR, f)
  return data
}

function main() {
  const staging = loadStagingAll()
  const decisions = readDecisions()
  const history = readHistory()
  const reviewQueue = fs.existsSync(path.join(REPORTS_DIR, 'review-queue.json'))
    ? readJson(REPORTS_DIR, 'review-queue.json')
    : []

  const byIssue = decisions // issueId -> current decision
  const appliedList = []
  const noteApplied = (issueId, category, resolution, version, targetIds) =>
    appliedList.push({ decisionId: `${issueId}@v${version}`, issueId, category, resolution, targets: targetIds })

  // ---- Championships ----
  const championships = (staging['championships.json'] || []).map((c) => {
    const id = issueIdOf('championship', c.stagingId)
    const d = byIssue[id]
    if (!d || !applied(d.status)) return c
    let reviewedConfidence = c.confidence
    let official = c.confidence === 'explicit'
    switch (d.resolution) {
      case 'upgrade_with_evidence':
        reviewedConfidence = 'verified'
        official = true
        break
      case 'downgrade_confidence':
        reviewedConfidence = 'unknown'
        official = false
        break
      case 'mark_disputed':
        reviewedConfidence = 'disputed'
        official = false
        break
      case 'exclude_from_official_totals':
        official = false
        break
      case 'include_historical_unofficial':
        official = false
        break
      case 'approve_current_confidence':
      default:
        break
    }
    noteApplied(id, 'championship', d.resolution, d.version, [c.stagingId])
    return {
      ...c,
      review: {
        decisionId: decisionRef(d),
        resolution: d.resolution,
        status: d.status,
        reviewedConfidence,
        official,
        // original confidence preserved on `confidence`
      },
    }
  })

  // ---- Matches ----
  const matches = (staging['matches.json'] || []).map((m) => {
    const id = issueIdOf('match', m.stagingId)
    const d = byIssue[id]
    if (!d || !applied(d.status)) return m
    const review = { decisionId: decisionRef(d), resolution: d.resolution, status: d.status }
    switch (d.resolution) {
      case 'mark_score_unavailable':
        review.reviewedScoreA = null
        review.reviewedScoreB = null
        break
      case 'mark_score_disputed':
        review.reviewedConfidence = 'disputed'
        break
      case 'correct_with_source':
        // corrections require evidence with source + replacement (enforced at decision time)
        review.reviewedScoreA = d.evidence?.replacementA ?? null
        review.reviewedScoreB = d.evidence?.replacementB ?? null
        review.source = d.evidence?.source ?? null
        review.confidence = d.evidence?.confidence ?? null
        break
      case 'resolution_forfeit':
        review.reviewedResolution = 'forfeit'
        break
      case 'resolution_walkover':
        review.reviewedResolution = 'walkover'
        break
      case 'resolution_bye':
        review.reviewedResolution = 'bye'
        break
      case 'resolution_admin_decision':
        review.reviewedResolution = 'admin_decision'
        break
      case 'preserve_as_archived':
      default:
        review.reviewedResolution = m.resolution
        break
    }
    noteApplied(id, 'match', d.resolution, d.version, [m.stagingId])
    return { ...m, review } // original scoreA/scoreB/resolution preserved
  })

  // ---- Entries (global entry-method decision) ----
  const emId = 'entry-method::global'
  const emDecision = byIssue[emId]
  const EM_MAP = {
    historical_import: 'ADMIN_ADDED',
    invited: 'ADMIN_INVITE',
    qualified: 'QUALIFIED',
    registered: 'PUBLIC_REGISTRATION',
    administrative_entry: 'ADMIN_ADDED',
    unknown: null,
  }
  const entries = (staging['entries.json'] || []).map((e) => {
    if (!emDecision || !applied(emDecision.status)) return e
    return {
      ...e,
      review: {
        decisionId: decisionRef(emDecision),
        reviewedEntryMethod: EM_MAP[emDecision.resolution] ?? null,
        resolution: emDecision.resolution,
      },
    }
  })
  if (emDecision && applied(emDecision.status)) noteApplied(emId, 'entry-method', emDecision.resolution, emDecision.version, ['entries.json'])

  // ---- Historical notes ----
  const notes = (staging['historical-notes.json'] || []).map((n) => {
    const id = issueIdOf('historical-note', n.stagingId)
    const d = byIssue[id]
    if (!d || !applied(d.status)) return n
    const VIS = {
      publish_annotation: 'public',
      keep_internal_only: 'internal',
      resolve_with_source: 'internal',
      mark_disputed: 'internal',
      leave_unresolved: 'internal',
    }
    noteApplied(id, 'historical-note', d.resolution, d.version, [n.stagingId])
    return {
      ...n,
      review: {
        decisionId: decisionRef(d),
        resolution: d.resolution,
        status: d.status,
        visibility: VIS[d.resolution] ?? 'internal',
        // bracket never rewritten
      },
    }
  })

  // ---- Identity recommendations (shared-alias / name-duplicate / merge-candidate) ----
  const identityRecommendations = []
  for (const [issueId, d] of Object.entries(byIssue)) {
    if (!applied(d.status)) continue
    if (['shared-alias', 'name-duplicate', 'merge-candidate'].includes(d.category)) {
      identityRecommendations.push({
        stagingId: `rec:${issueId}`,
        issueId,
        category: d.category,
        resolution: d.resolution,
        relatedIds: d.relatedIds,
        note: d.note || null,
        decisionId: decisionRef(d),
        applied: false, // a recommendation only — no player identity is mutated here
      })
      noteApplied(issueId, d.category, d.resolution, d.version, d.relatedIds)
    }
  }
  identityRecommendations.sort((a, b) => a.stagingId.localeCompare(b.stagingId))

  // ---- Write reviewed-staging (copy everything; override transformed files) ----
  fs.mkdirSync(REVIEWED_DIR, { recursive: true })
  const overrides = {
    'championships.json': championships,
    'matches.json': matches,
    'entries.json': entries,
    'historical-notes.json': notes,
  }
  for (const [name, data] of Object.entries(staging)) {
    if (name === 'manifest.json') continue
    writeJson(REVIEWED_DIR, name, overrides[name] || data)
  }
  writeJson(REVIEWED_DIR, 'identity-recommendations.json', identityRecommendations)

  // ---- Unresolved-after-review (issue universe with no applied decision) ----
  const ACTIONABLE = ['shared-alias', 'merge-candidate', 'name-duplicate', 'match', 'championship']
  const universe = []
  for (const item of reviewQueue) {
    if (!ACTIONABLE.includes(item.type)) continue
    universe.push({ issueId: issueIdOf(item.type, item.ref), category: item.type, ref: item.ref, severity: item.severity })
  }
  for (const n of staging['historical-notes.json'] || [])
    universe.push({ issueId: issueIdOf('historical-note', n.stagingId), category: 'historical-note', ref: n.stagingId, severity: 'info' })
  universe.push({ issueId: 'entry-method::global', category: 'entry-method', ref: 'global', severity: 'medium' })

  const unresolved = universe
    .filter((u) => {
      const d = byIssue[u.issueId]
      return !d || !applied(d.status)
    })
    .map((u) => ({ ...u, status: byIssue[u.issueId]?.status || 'pending' }))
    .sort((a, b) => a.issueId.localeCompare(b.issueId))

  // ---- Progress ----
  const byCategory = {}
  for (const u of universe) {
    const cat = u.category
    byCategory[cat] = byCategory[cat] || { total: 0, pending: 0, approved: 0, rejected: 0, deferred: 0, needs_evidence: 0, resolved: 0 }
    byCategory[cat].total++
    const st = byIssue[u.issueId]?.status || 'pending'
    byCategory[cat][st] = (byCategory[cat][st] || 0) + 1
  }
  const totals = { total: universe.length, decided: Object.keys(byIssue).length, applied: appliedList.length, unresolved: unresolved.length }

  writeJson(REVIEWED_DIR, 'reviewed-manifest.json', {
    source: 'data/staging (unmodified) + approved review decisions',
    appliedDecisions: appliedList.length,
    counts: Object.fromEntries(Object.entries(staging).filter(([n]) => n !== 'manifest.json').map(([n, d]) => [n.replace('.json', ''), d.length])),
    note: 'Derived layer. data/staging is never modified. Deterministic given the decisions set.',
  })
  writeJson(REPORTS_DIR, 'applied-decisions.json', appliedList.sort((a, b) => a.decisionId.localeCompare(b.decisionId)))
  writeJson(REPORTS_DIR, 'unresolved-after-review.json', unresolved)
  writeJson(REPORTS_DIR, 'review-progress.json', { totals, byCategory })

  // ---- Reviewed title-count preview (how approved decisions WOULD affect official totals) ----
  const nameByLegacy = new Map((staging['players.json'] || []).map((p) => [p.legacyPlayerId, p.primaryName]))
  const curT = new Map()
  const revT = new Map()
  for (const c of championships) {
    const cid = c.championCompetitorStagingId
    if (!cid) continue
    const curOfficial = c.confidence === 'explicit'
    const revOfficial = c.review ? !!c.review.official : curOfficial
    curT.set(cid, (curT.get(cid) || 0) + (curOfficial ? 1 : 0))
    revT.set(cid, (revT.get(cid) || 0) + (revOfficial ? 1 : 0))
  }
  const titleRows = [...new Set([...curT.keys(), ...revT.keys()])]
    .map((cid) => {
      const legacy = cid.replace(/^co:/, '')
      return { competitor: cid, legacyId: legacy, name: nameByLegacy.get(legacy) || legacy, current: curT.get(cid) || 0, reviewed: revT.get(cid) || 0 }
    })
    .filter((r) => r.current > 0 || r.reviewed > 0)
    .map((r) => ({ ...r, delta: r.reviewed - r.current }))
    .sort((a, b) => b.reviewed - a.reviewed || b.current - a.current || a.legacyId.localeCompare(b.legacyId))
  const changed = titleRows.filter((r) => r.delta !== 0)
  writeJson(REPORTS_DIR, 'reviewed-title-counts.json', {
    note: 'Preview of official title totals under approved decisions. Public title totals are NOT changed in this phase.',
    playersWithTitles: titleRows.length,
    changed: changed.length,
    players: titleRows,
  })
  writeText(
    REPORTS_DIR,
    'REVIEWED_TITLE_COUNTS.md',
    `# Reviewed Title-Count Preview\n\n> How approved review decisions WOULD affect official title totals. Public totals are NOT changed in this phase.\n\n- Players with official titles: ${titleRows.length}\n- Players whose total changes under current decisions: ${changed.length}\n\n## Top official title leaders (reviewed)\n\n| Player | Legacy | Current | Reviewed | Δ |\n|---|---|---|---|---|\n${titleRows.slice(0, 20).map((r) => `| ${r.name} | ${r.legacyId} | ${r.current} | ${r.reviewed} | ${r.delta} |`).join('\n')}\n${changed.length ? `\n## Changes\n\n${changed.map((r) => `- ${r.name} (${r.legacyId}): ${r.current} → ${r.reviewed}`).join('\n')}\n` : ''}`,
  )

  // ---- Markdown reports ----
  const catTable = (obj) =>
    '| Category | Total | Pending | Approved | Rejected | Deferred | Needs evidence | Resolved |\n|---|---|---|---|---|---|---|---|\n' +
    Object.entries(obj)
      .map(([k, v]) => `| ${k} | ${v.total} | ${v.pending || 0} | ${v.approved || 0} | ${v.rejected || 0} | ${v.deferred || 0} | ${v.needs_evidence || 0} | ${v.resolved || 0} |`)
      .join('\n')

  writeText(
    REPORTS_DIR,
    'REVIEW_PROGRESS_REPORT.md',
    `# Review Progress Report\n\n> Local review of staged archive issues. No database import; raw archive & staging untouched.\n\n- Total issues: **${totals.total}**\n- Decisions recorded: **${totals.decided}**\n- Applied (approved/resolved): **${totals.applied}**\n- Unresolved: **${totals.unresolved}**\n\n## By category\n\n${catTable(byCategory)}\n`,
  )

  const auditRows = history
    .map(
      (h) =>
        `| ${h.issueId} | ${h.category} | v${h.version} | ${h.status} | ${h.resolution} | ${h.reviewer} | ${h.timestamp} | ${h.previous ? 'v' + h.previous.version : '—'} |`,
    )
    .join('\n')
  writeText(
    REPORTS_DIR,
    'REVIEW_DECISION_AUDIT.md',
    `# Review Decision Audit\n\n> Append-only history of every decision write. Prior decisions are never overwritten or deleted.\n\nTotal decision writes: **${history.length}**\n\n| Issue | Category | Version | Status | Resolution | Reviewer | Timestamp | Replaced |\n|---|---|---|---|---|---|---|---|\n${auditRows || '| — | | | | | | | |'}\n`,
  )

  writeText(
    REPORTS_DIR,
    'REVIEWED_STAGING_SUMMARY.md',
    `# Reviewed Staging Summary\n\n> \`data/reviewed-staging/\` is a derived layer: staging + approved decisions. \`data/staging/\` is never modified.\n\n- Applied decisions: **${appliedList.length}**\n- Identity recommendations (advisory, no identities mutated): **${identityRecommendations.length}**\n- Championships reviewed: **${matches ? championships.filter((c) => c.review).length : 0}**\n- Matches reviewed: **${matches.filter((m) => m.review).length}**\n- Historical notes reviewed: **${notes.filter((n) => n.review).length}**\n- Entry-method applied: **${emDecision && applied(emDecision.status) ? 'yes' : 'no'}**\n- Unresolved after review: **${unresolved.length}**\n\nOriginal values and provenance are preserved on every record; reviewed changes live under a \`review\` field.\n`,
  )

  console.log('archive:apply-reviews complete →', REVIEWED_DIR)
  console.log(`  applied decisions: ${appliedList.length} | unresolved: ${unresolved.length} | recommendations: ${identityRecommendations.length}`)
}

main()
