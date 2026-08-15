/**
 * RANKED-ACCOUNT MIGRATION — DRY RUN / pre-migration analysis (read-only).
 *
 * Reads the authoritative mapping (fixed accounts.txt), resolves each ranked name to a canonical
 * identity, checks for an existing permanent account (payload.users) and an existing canonical
 * Player profile, classifies the action the executor would take, and surfaces duplicates / ambiguous
 * / unresolved mappings. Writes an admin-only report. Makes NO writes.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json scripts/migrate-ranked-accounts-dryrun.mts
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../src/lib/prisma.ts'
import { resolveIdentity } from '../src/lib/stats/identity.ts'

// Self-contained paths: resolve relative to this WCC project's root (scripts/ is one level down).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAP_FILE = path.join(REPO_ROOT, 'archive', 'migration-inputs', 'fixed accounts.txt')
const OUT_DIR = path.join(REPO_ROOT, 'migration-reports')
const nk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

interface Entry { line: number; oldName: string; mappedId: string | null; mergeInto: number | null }
function parseMapping(): Entry[] {
  const text = readFileSync(MAP_FILE, 'utf8')
  const out: Entry[] = []
  let line = 0
  for (const raw of text.split(/\r?\n/)) {
    line++
    if (!raw.trim()) continue
    const cols = raw.split(/\t+/).map((c) => c.trim()).filter(Boolean)
    if (cols.length < 2) { out.push({ line, oldName: cols[0] ?? '', mappedId: null, mergeInto: null }); continue }
    const oldName = cols[0]
    const right = cols.slice(1).join(' ')
    const merge = right.match(/merge with .* #(\d+)/i)
    if (merge) out.push({ line, oldName, mappedId: null, mergeInto: Number(merge[1]) })
    else out.push({ line, oldName, mappedId: right, mergeInto: null })
  }
  return out
}

async function accountFor(username: string): Promise<{ id: number; username: string; email: string } | null> {
  const rows = await prisma.$queryRawUnsafe<{ id: number; username: string; email: string }[]>(
    `SELECT id, username, email FROM payload.users WHERE lower(username) = lower($1) LIMIT 1`, username,
  )
  return rows[0] ?? null
}

async function candidatePlayers(oldName: string, mappedId: string, canonicalId: string) {
  const keys = [oldName, mappedId]
  const nkeys = keys.map(nk).filter(Boolean)
  return prisma.player.findMany({
    where: {
      OR: [
        { primaryName: { in: keys, mode: 'insensitive' } },
        { cueverseId: { in: keys, mode: 'insensitive' } },
        { legacyPlayerId: canonicalId },
        { aliases: { some: { alias: { in: nkeys } } } },
        ...(canonicalId ? [{ id: canonicalId }] : []),
      ],
    },
    select: { id: true, primaryName: true, cueverseId: true, linkedUserId: true, legacyPlayerId: true },
  })
}

const entries = parseMapping()
const rows: string[] = []
const summary = { created: 0, linkedAccount: 0, createProfile: 0, linkProfile: 0, duplicates: 0, ambiguous: 0, unresolved: 0, merges: 0 }
const dupNotes: string[] = []
const ambiguousNotes: string[] = []

for (const e of entries) {
  if (e.mergeInto != null) {
    summary.merges++
    rows.push(`| ${e.line} | ${e.oldName} | — | (merge into #${e.mergeInto}) | — | — | MERGE | Fold this ranking into row #${e.mergeInto} — do not create a separate account |`)
    continue
  }
  const mappedId = e.mappedId ?? ''
  const resolved = resolveIdentity(e.oldName, e.oldName, { unknownAsSelf: true })
  const canonicalId = resolved?.id ?? ''
  const acct = mappedId ? await accountFor(mappedId) : null
  const players = mappedId ? await candidatePlayers(e.oldName, mappedId, canonicalId) : []

  let accountAction = acct ? `LINK existing user #${acct.id}` : 'CREATE account'
  if (acct) summary.linkedAccount++; else summary.created++

  let profileAction: string
  let note = ''
  if (players.length === 0) { profileAction = 'CREATE profile'; summary.createProfile++ }
  else if (players.length === 1) {
    profileAction = `LINK profile ${players[0].id}`
    summary.linkProfile++
    if (players[0].linkedUserId && (!acct || players[0].linkedUserId !== String(acct.id))) {
      note = `profile already linked to user #${players[0].linkedUserId}`
    }
  } else {
    profileAction = 'AMBIGUOUS'
    summary.ambiguous++
    ambiguousNotes.push(`Row ${e.line} "${e.oldName}"→${mappedId}: ${players.length} candidate profiles: ${players.map((p) => `${p.primaryName}(${p.id.slice(0, 8)})`).join(', ')}`)
    note = 'multiple candidate profiles — MANUAL REVIEW'
  }
  if (resolved && !resolved.ok) { summary.unresolved++; note = (note ? note + '; ' : '') + 'identity unresolved' }

  rows.push(`| ${e.line} | ${e.oldName} | ${mappedId} | ${canonicalId} | ${accountAction} | ${profileAction} | ${resolved?.ok === false ? 'UNRESOLVED' : players.length > 1 ? 'REVIEW' : 'OK'} | ${note} |`)
}

// Detect duplicate accounts (same username case-insensitively) + duplicate cueverseId profiles.
const allUsers = await prisma.$queryRawUnsafe<{ id: number; username: string }[]>(`SELECT id, lower(username) AS username FROM payload.users`)
const byName = new Map<string, number[]>()
for (const u of allUsers) { const a = byName.get(u.username) ?? []; a.push(u.id); byName.set(u.username, a) }
for (const [name, ids] of byName) if (ids.length > 1) { summary.duplicates++; dupNotes.push(`Duplicate account username "${name}": user ids ${ids.join(', ')}`) }
const players = await prisma.player.findMany({ select: { id: true, primaryName: true, cueverseId: true, linkedUserId: true } })
const byCue = new Map<string, string[]>()
for (const p of players) if (p.cueverseId) { const k = nk(p.cueverseId); const a = byCue.get(k) ?? []; a.push(`${p.primaryName}(${p.id.slice(0, 8)})`); byCue.set(k, a) }
for (const [k, arr] of byCue) if (arr.length > 1) dupNotes.push(`Duplicate CueVerse ID "${k}" across profiles: ${arr.join(', ')}`)
// Dangling linkedUserId (points at a non-existent account).
const userIds = new Set(allUsers.map((u) => u.id))
for (const p of players) if (p.linkedUserId && !userIds.has(Number(p.linkedUserId))) dupNotes.push(`Dangling link: profile ${p.primaryName}(${p.id.slice(0, 8)}) → non-existent user #${p.linkedUserId}`)

const report = [
  `# Ranked-account migration — PRE-MIGRATION (dry run)`,
  ``,
  `Mapping file: ${MAP_FILE}`,
  `Entries: ${entries.length} (${summary.merges} merge directive)`,
  ``,
  `## Plan`,
  ``,
  `| # | Ranking Name | Mapped User ID | Canonical Id | Account | Profile | Status | Notes |`,
  `|---|---|---|---|---|---|---|---|`,
  ...rows,
  ``,
  `## Summary`,
  `- Accounts to CREATE: ${summary.created}`,
  `- Accounts to LINK (already exist): ${summary.linkedAccount}`,
  `- Profiles to CREATE: ${summary.createProfile}`,
  `- Profiles to LINK: ${summary.linkProfile}`,
  `- Merge directives: ${summary.merges}`,
  `- Ambiguous (manual review): ${summary.ambiguous}`,
  `- Unresolved identities: ${summary.unresolved}`,
  `- Duplicate/dangling records found: ${dupNotes.length}`,
  ``,
  `## Ambiguous mappings (manual review required)`,
  ...(ambiguousNotes.length ? ambiguousNotes.map((n) => `- ${n}`) : ['- none']),
  ``,
  `## Duplicate / dangling records discovered`,
  ...(dupNotes.length ? dupNotes.map((n) => `- ${n}`) : ['- none']),
  ``,
].join('\n')

mkdirSync(OUT_DIR, { recursive: true })
const outFile = `${OUT_DIR}/pre-migration-dryrun.md`
writeFileSync(outFile, report, 'utf8')
console.log(report)
console.log(`\nReport written: ${outFile}`)
await prisma.$disconnect()
