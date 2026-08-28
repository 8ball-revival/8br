// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import '../_retired.mjs'

/**
 * archive:review-packet — export selected unresolved issues into deterministic JSON +
 * Markdown packets under reports/archive/review-packets/. READ-ONLY: never modifies
 * decisions or staging.
 *   npm run archive:review-packet -- --category shared-alias
 *   npm run archive:review-packet -- --issues "shared-alias::foo,match::ma:g:123"
 */
import path from 'node:path'
import { REPORTS_DIR, STAGING_DIR, readJson, writeJson, writeText, fileExists } from './lib/io.mjs'
import { readDecisions } from './lib/decisions.mjs'

const argv = process.argv.slice(2)
const val = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  if (hit) return hit.split('=').slice(1).join('=')
  const idx = argv.indexOf(`--${name}`)
  return idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--') ? argv[idx + 1] : undefined
}

const QUESTIONS = {
  'shared-alias': ['Which canonical player owns this alias, or is it genuinely shared/ambiguous?', 'Is a merge or split recommendation warranted?'],
  'merge-candidate': ['Do the shared identifiers justify a merge recommendation, or keep separate?'],
  'name-duplicate': ['Same person or different people? Name alone is low-confidence.'],
  match: ['Preserve as archived, mark disputed/unavailable, or correct with a cited source?', 'Is this a forfeit/walkover/bye/administrative result?'],
  championship: ['Keep current confidence, upgrade with evidence, downgrade, dispute, or exclude from official totals?'],
  'historical-note': ['Publish, keep internal, resolve with source, or leave unresolved?'],
  'entry-method': ['Confirm the historical default entry method.'],
}

function main() {
  const category = val('category')
  const issuesArg = val('issues')
  const context = fileExists(path.join(REPORTS_DIR, 'review-context.json')) ? readJson(REPORTS_DIR, 'review-context.json') : {}
  const reviewQueue = fileExists(path.join(REPORTS_DIR, 'review-queue.json')) ? readJson(REPORTS_DIR, 'review-queue.json') : []
  const notes = fileExists(path.join(STAGING_DIR, 'historical-notes.json')) ? readJson(STAGING_DIR, 'historical-notes.json') : []
  const decisions = readDecisions()

  const issueIdOf = (type, ref) => `${type}::${ref}`
  const all = []
  for (const it of reviewQueue) all.push({ issueId: issueIdOf(it.type, it.ref), category: it.type, ref: it.ref, reason: it.reason, severity: it.severity })
  for (const n of notes) all.push({ issueId: issueIdOf('historical-note', n.stagingId), category: 'historical-note', ref: n.stagingId, reason: n.title, severity: 'info' })

  let selected
  let packetName
  if (issuesArg) {
    const ids = new Set(issuesArg.split(',').map((s) => s.trim()).filter(Boolean))
    selected = all.filter((i) => ids.has(i.issueId))
    packetName = 'selection'
  } else if (category) {
    selected = all.filter((i) => i.category === category)
    packetName = category
  } else {
    console.error('Provide --category <name> or --issues "id1,id2".')
    process.exit(1)
  }

  const items = selected
    .sort((a, b) => a.issueId.localeCompare(b.issueId))
    .map((i) => ({
      issueId: i.issueId,
      category: i.category,
      ref: i.ref,
      severity: i.severity,
      reason: i.reason,
      context: context[i.issueId] ?? null,
      currentDecision: decisions[i.issueId]
        ? { resolution: decisions[i.issueId].resolution, status: decisions[i.issueId].status, version: decisions[i.issueId].version }
        : null,
      questionsRequiringResolution: QUESTIONS[i.category] ?? [],
    }))

  const packet = { packet: packetName, generatedFrom: 'reports/archive/review-context.json + review-queue.json (read-only)', count: items.length, items }

  const dir = path.join(REPORTS_DIR, 'review-packets')
  writeJson(dir, `packet-${packetName}.json`, packet)

  const md = [
    `# Review Packet — ${packetName}`,
    '',
    `> Read-only export. Decisions are NOT modified. ${items.length} issue(s).`,
    '',
    ...items.map((it) =>
      [
        `## ${it.issueId}`,
        ``,
        `- Category: ${it.category} · severity: ${it.severity}`,
        `- ${it.reason}`,
        it.context?.signals?.length ? `- Evidence signals: ${it.context.signals.join(', ')}` : it.context?.diagnostics?.length ? `- Diagnostics: ${it.context.diagnostics.join(', ')}` : '',
        it.currentDecision ? `- Current decision: ${it.currentDecision.resolution} (${it.currentDecision.status}, v${it.currentDecision.version})` : `- Current decision: none`,
        `- Questions: ${it.questionsRequiringResolution.join(' / ')}`,
        '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n')
  writeText(dir, `packet-${packetName}.md`, md + '\n')

  console.log(`archive:review-packet complete → reports/archive/review-packets/packet-${packetName}.{json,md} (${items.length} issues)`)
}

main()
