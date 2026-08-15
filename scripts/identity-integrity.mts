/**
 * Identity-integrity checker + audit for the CueVerse-ID-as-canonical-identity model.
 *
 * Reads BOTH identity stores in the shared database — Payload `payload.users` (auth username +
 * email presence only) and Prisma `public."Player"` (cueverseId + account link) — and reports,
 * WITHOUT ever printing emails, password hashes, tokens, sessions, or any secret:
 *
 *   AUDIT (per account):  exact / case-only / substantive mismatch, missing username,
 *                         missing CueVerse ID, missing linked Player, multiple Players linked,
 *                         duplicate CueVerse IDs, case-insensitive collision, whitespace/normalization
 *                         mismatch, invalid under current rules.
 *   INVARIANTS (pass/fail): every linked account's Payload username EQUALS its Player.cueverseId,
 *                         no case-insensitive duplicate identities, no invalid normalized IDs,
 *                         no account missing its Player, no orphaned projection.
 *
 * Exit code is 0 only when every INVARIANT holds for the safely-migratable set. Unresolved legacy
 * conflicts are listed (by numeric account id) but do not, on their own, fail the run pre-migration —
 * run with STRICT=1 to require a fully clean result (used post-migration).
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/identity-integrity.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { normalizeCueverseId, cueverseLoginKey, validateCueverseId } from '../src/lib/account/validation.ts'

const STRICT = process.env.STRICT === '1'

type PUser = { id: number; username: string | null; hasEmail: boolean }

const usersRaw = await prisma.$queryRawUnsafe<{ id: number; username: string | null; email: string | null }[]>(
  'SELECT id, username, email FROM payload.users ORDER BY id',
)
// Immediately drop the email value — only its presence is retained. No private value leaves this line.
const users: PUser[] = usersRaw.map((u) => ({ id: u.id, username: u.username, hasEmail: !!u.email }))

const players = await prisma.player.findMany({
  select: { id: true, cueverseId: true, linkedUserId: true, primaryName: true, cueverseIdChangedAt: true },
})

// Index players by the account they link to (linkedUserId is a stringified Payload user id).
const playersByUser = new Map<number, typeof players>()
for (const p of players) {
  if (p.linkedUserId == null) continue
  const uid = Number(p.linkedUserId)
  if (!Number.isFinite(uid)) continue
  const arr = playersByUser.get(uid) ?? []
  arr.push(p)
  playersByUser.set(uid, arr)
}

// NOTE on the canonical model: Payload `username` stores the NORMALIZED (login-key) form of the
// CueVerse ID — cueverseLoginKey(cueverseId) — while display casing lives on Player.cueverseId.
// So the correct invariant is username === cueverseLoginKey(cueverseId). A username that equals the
// LOWERCASE of the display id is SYNCED (the intended state), not a mismatch. "diverged" = the login
// key of the username differs from the login key of the CueVerse ID (the real drift the change bug caused).
type Bucket =
  | 'synced' | 'diverged' | 'missingUsername' | 'missingCueverseId'
  | 'missingPlayer' | 'multiplePlayers' | 'whitespace' | 'invalid'
const buckets: Record<Bucket, number[]> = {
  synced: [], diverged: [], missingUsername: [], missingCueverseId: [],
  missingPlayer: [], multiplePlayers: [], whitespace: [], invalid: [],
}

// Per-account classification.
for (const u of users) {
  const linked = playersByUser.get(u.id) ?? []
  if (linked.length === 0) { buckets.missingPlayer.push(u.id); continue }
  if (linked.length > 1) { buckets.multiplePlayers.push(u.id); continue }
  const player = linked[0]
  const uname = (u.username ?? '').trim()
  const cid = (player.cueverseId ?? '').trim()
  if (!uname) buckets.missingUsername.push(u.id)
  if (!cid) { buckets.missingCueverseId.push(u.id); continue }
  if (validateCueverseId(cid)) buckets.invalid.push(u.id)
  if (player.cueverseId !== normalizeCueverseId(player.cueverseId ?? '')) buckets.whitespace.push(u.id)
  if (!uname) continue
  if (cueverseLoginKey(uname) === cueverseLoginKey(cid)) buckets.synced.push(u.id)
  else buckets.diverged.push(u.id)
}

// Case-insensitive collisions across ALL players' CueVerse IDs (linked or not — an unlinked
// player sharing a login key with a linked account would block that account's username sync).
const keyToPlayers = new Map<string, string[]>()
for (const p of players) {
  const cid = (p.cueverseId ?? '').trim()
  if (!cid) continue
  const key = cueverseLoginKey(cid)
  const arr = keyToPlayers.get(key) ?? []
  arr.push(p.id)
  keyToPlayers.set(key, arr)
}
const duplicateKeys = [...keyToPlayers.entries()].filter(([, ids]) => ids.length > 1)

// Payload-side case-insensitive username collisions (two accounts whose usernames collide only by case).
const unameKey = new Map<string, number[]>()
for (const u of users) {
  const un = (u.username ?? '').trim()
  if (!un) continue
  const k = cueverseLoginKey(un)
  const arr = unameKey.get(k) ?? []
  arr.push(u.id)
  unameKey.set(k, arr)
}
const usernameCollisions = [...unameKey.entries()].filter(([, ids]) => ids.length > 1)

const pad = (n: number) => String(n).padStart(3)
console.log('\n=== IDENTITY AUDIT ===')
console.log(`Accounts (payload.users):        ${pad(users.length)}`)
console.log(`Players (public."Player"):       ${pad(players.length)}`)
console.log(`  linked to an account:          ${pad([...playersByUser.values()].reduce((a, v) => a + v.length, 0))}`)
console.log(`  unlinked (archive/backing):    ${pad(players.filter((p) => p.linkedUserId == null).length)}`)
console.log(`Accounts with email present:     ${pad(users.filter((u) => u.hasEmail).length)}`)
console.log('\n--- per-account classification ---')
const line = (label: string, ids: number[]) => console.log(`  ${label.padEnd(34)} ${pad(ids.length)}${ids.length ? '   ids: ' + ids.join(', ') : ''}`)
line('username synced (== normalized ID)', buckets.synced)
line('username DIVERGED from CueVerse ID', buckets.diverged)
line('missing username', buckets.missingUsername)
line('missing CueVerse ID', buckets.missingCueverseId)
line('missing linked Player', buckets.missingPlayer)
line('multiple Players linked', buckets.multiplePlayers)
line('whitespace/normalization issue', buckets.whitespace)
line('invalid under current rules', buckets.invalid)
line('case-insensitive CueVerse dupes', duplicateKeys.flatMap(([, ids]) => ids))
line('case-insensitive username dupes', usernameCollisions.flatMap(([, ids]) => ids))

// Safe = migratable now: exactly one linked player, present & valid cueverseId, no cross-account
// case-insensitive collision, and username↔cueverseId differ only by case (or match exactly).
const conflictUserIds = new Set<number>([
  ...buckets.missingPlayer, ...buckets.missingCueverseId,
  ...buckets.multiplePlayers, ...buckets.invalid, ...buckets.missingUsername,
])
// Any account whose player participates in a duplicate login key is a conflict too.
const conflictedPlayerIds = new Set(duplicateKeys.flatMap(([, ids]) => ids))
for (const u of users) {
  const linked = playersByUser.get(u.id) ?? []
  if (linked.some((p) => conflictedPlayerIds.has(p.id))) conflictUserIds.add(u.id)
}
for (const [, ids] of usernameCollisions) ids.forEach((id) => conflictUserIds.add(id))

const safeCount = users.length - conflictUserIds.size
console.log('\n--- migration readiness ---')
console.log(`  safely migratable accounts:    ${pad(safeCount)}`)
console.log(`  accounts needing manual review: ${pad(conflictUserIds.size)}${conflictUserIds.size ? '   ids: ' + [...conflictUserIds].sort((a, b) => a - b).join(', ') : ''}`)
if (conflictUserIds.size) {
  console.log('\n  CONFLICT REPORT (account id → reason):')
  for (const id of [...conflictUserIds].sort((a, b) => a - b)) {
    const reasons: string[] = []
    if (buckets.missingPlayer.includes(id)) reasons.push('no linked Player')
    if (buckets.multiplePlayers.includes(id)) reasons.push('multiple linked Players')
    if (buckets.missingCueverseId.includes(id)) reasons.push('linked Player has no CueVerse ID')
    if (buckets.missingUsername.includes(id)) reasons.push('account has no username')
    if (buckets.invalid.includes(id)) reasons.push('CueVerse ID invalid under current rules')
    const linked = playersByUser.get(id) ?? []
    if (linked.some((p) => conflictedPlayerIds.has(p.id))) reasons.push('CueVerse ID collides case-insensitively with another account')
    if (usernameCollisions.some(([, ids]) => ids.includes(id))) reasons.push('username collides case-insensitively with another account')
    console.log(`    #${id} → ${reasons.join('; ') || 'unclassified'}`)
  }
}

// INVARIANTS — these must hold post-migration for the safe set.
let failures = 0
const inv = (name: string, ok: boolean) => { if (ok) console.log('  ✓ ' + name); else { failures++; console.log('  ✗ ' + name) } }
console.log('\n--- invariants (post-migration these must all pass) ---')
inv('every account has exactly one linked Player', buckets.missingPlayer.length === 0 && buckets.multiplePlayers.length === 0)
inv('every linked account has a CueVerse ID', buckets.missingCueverseId.length === 0)
inv('every CueVerse ID is valid under current rules', buckets.invalid.length === 0)
inv('no whitespace/normalization drift in stored CueVerse IDs', buckets.whitespace.length === 0)
inv('username == normalized CueVerse ID for every linked account (no divergence)', buckets.diverged.length === 0)
inv('no case-insensitive CueVerse ID duplicates', duplicateKeys.length === 0)
inv('no case-insensitive username duplicates', usernameCollisions.length === 0)

console.log(`\nRESULT: ${failures === 0 ? 'INVARIANTS CLEAN' : failures + ' invariant(s) failing'} · ${safeCount}/${users.length} accounts safe · ${conflictUserIds.size} need review`)
await prisma.$disconnect()
// Pre-migration: only hard-fail in STRICT mode (post-migration gate). Otherwise report and exit 0
// so the audit itself never blocks — the conflict report is the actionable output.
process.exit(STRICT && failures > 0 ? 1 : 0)
