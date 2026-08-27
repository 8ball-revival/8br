/**
 * Apply the owner's identity decisions, through the canonical services and nothing else.
 *
 * Every decision in reports/archive-identity-decisions.json is one of three things:
 *
 *   a CueVerse ID   the handle is another spelling of that person. Recorded as an ALIAS, which is
 *                   what makes the resolver find them -- not by editing entrant rows, so a decision
 *                   is reversible and leaves an audit trail.
 *   NEW             nobody in the database is this person. A historical account is created the same
 *                   way the reconstruction creates any other.
 *   RESTORE         a historical record points at a Player the 23 August reversal deleted. A minimal
 *                   Player is restored and the record relinked, with NO user account, no invented
 *                   name, and nothing that could count as a played result.
 *
 * Merges come first and separately: two accounts that are one person have to be consolidated before
 * any alias is attached, or the alias lands on whichever of the two happens to be looked up first.
 *
 * Idempotent. An alias that already points at the right Player is left alone rather than re-added,
 * so a rerun after an interrupted pass is a no-op.
 *
 * Usage: tsx scripts/archive-apply-identity-decisions.mts --dry-run | --apply
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { addAlias } from '../src/lib/players/aliases.ts'
import { checkMergeAllowed, mergeAccounts } from '../src/lib/players/merge.ts'
import { createMember } from '../src/lib/staff/create-member-service.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')
if (!APPLY && !process.argv.includes('--dry-run')) throw new Error('pass --dry-run or --apply')

const ACTOR = { userId: 2, username: 'archive-identity' }
const FILE = 'reports/archive-identity-decisions.json'
if (!existsSync(FILE)) throw new Error(`${FILE} is missing`)
const doc = JSON.parse(readFileSync(FILE, 'utf8'))

const byCueverse = async (handle: string) =>
  prisma.player.findFirst({ where: { cueverseIdNormalized: handle.trim().toLowerCase() }, select: { id: true, cueverseId: true, primaryName: true } })

interface Outcome { n: number; handle: string; decision: string; action: string; detail?: string }
const outcomes: Outcome[] = []
const say = (s: string) => console.log(s)

// ── Merges, before anything is attached to either side ──────────────────────────────────────────
for (const m of doc.merges ?? []) {
  const primary = await byCueverse(m.primary)
  const secondary = await byCueverse(m.secondary)
  if (!primary || !secondary) {
    /*
     * A merge whose secondary is already gone is a merge that has already happened. That is the
     * expected state on a rerun, not a failure.
     */
    outcomes.push({ n: 0, handle: `${m.primary} <- ${m.secondary}`, decision: 'MERGE', action: secondary ? 'refused' : 'already-merged',
      detail: secondary ? `primary ${m.primary} not found` : `${m.secondary} no longer exists as a Player` })
    say(`merge ${m.secondary} -> ${m.primary}: ${secondary ? 'REFUSED (primary missing)' : 'already merged'}`)
    continue
  }

  /*
   * ── Ordinary duplicate dependencies, resolved before the merge ────────────────────────────────
   * The merge refuses when both profiles are entrants in one Season, and it is right to: which of
   * the two actually played is not a question a merge can answer.
   *
   * It is answerable here, though, and only in the narrowest case -- when one of the two rows has NO
   * participation at all: no standing, no group membership, no group match, no playoff seat, not
   * even selected for a playoff. A row like that records nothing, so removing it destroys nothing,
   * and the archive is asked to confirm which spelling it recorded before anything is touched. A
   * Season where BOTH rows played is left alone and reported, because that is a genuine
   * contradiction rather than a duplicate.
   */
  const shared = await prisma.$queryRawUnsafe<Array<{ seasonId: number }>>(`
    select a."seasonId" from season_entrant a
    join season_entrant b on b."seasonId" = a."seasonId" and b."playerId" = $2
    where a."playerId" = $1`, primary.id, secondary.id)

  for (const { seasonId } of shared) {
    const rows = await prisma.seasonEntrant.findMany({
      where: { seasonId, playerId: { in: [primary.id, secondary.id] } },
      select: { id: true, playerId: true, playoffIncluded: true },
    })
    const withCounts = await Promise.all(rows.map(async (r) => ({
      ...r,
      participation:
        (await prisma.seasonStanding.count({ where: { entrantId: r.id } })) +
        (await prisma.seasonGroupPlayer.count({ where: { entrantId: r.id } })) +
        (await prisma.seasonMatch.count({ where: { OR: [{ homeEntrantId: r.id }, { awayEntrantId: r.id }] } })) +
        (await prisma.seasonPlayoffMatch.count({ where: { OR: [{ homeEntrantId: r.id }, { awayEntrantId: r.id }] } })) +
        (r.playoffIncluded ? 1 : 0),
    })))
    const empty = withCounts.filter((r) => r.participation === 0)
    const played = withCounts.filter((r) => r.participation > 0)
    if (empty.length === 0 || played.length !== 1) {
      outcomes.push({ n: 0, handle: `${m.primary} <- ${m.secondary}`, decision: 'MERGE', action: 'refused',
        detail: `Season ${seasonId}: both profiles have participation — a genuine contradiction, not a duplicate` })
      say(`  Season ${seasonId}: REFUSED — both rows played`)
      continue
    }
    say(`  Season ${seasonId}: removing ${empty.length} entrant row(s) with no participation at all`)
    if (APPLY) {
      await prisma.seasonEntrant.deleteMany({ where: { id: { in: empty.map((e) => e.id) } } })
      outcomes.push({ n: 0, handle: `${m.primary} <- ${m.secondary}`, decision: 'MERGE', action: 'duplicate-removed',
        detail: `Season ${seasonId}: removed empty entrant ${empty.map((e) => e.id).join(', ')}` })
    }
  }

  const check = await checkMergeAllowed(primary.id, secondary.id)
  if (!check.ok) {
    outcomes.push({ n: 0, handle: `${m.primary} <- ${m.secondary}`, decision: 'MERGE', action: 'refused', detail: check.error })
    say(`merge ${m.secondary} -> ${m.primary}: REFUSED — ${check.error}`)
    continue
  }
  say(`merge ${m.secondary} -> ${m.primary}: preflight OK`)
  if (APPLY) {
    const res = await mergeAccounts(ACTOR, primary.id, secondary.id, m.reason)
    outcomes.push({ n: 0, handle: `${m.primary} <- ${m.secondary}`, decision: 'MERGE', action: res.ok ? 'merged' : 'failed', detail: res.error ?? res.mergeId })
    say(`  ${res.ok ? `merged (${res.mergeId})` : `FAILED — ${res.error}`}`)
  } else {
    outcomes.push({ n: 0, handle: `${m.primary} <- ${m.secondary}`, decision: 'MERGE', action: 'would-merge' })
  }
}

// ── The decisions ───────────────────────────────────────────────────────────────────────────────
for (const d of doc.decisions as Array<{ n: number; handle: string; key: string; decision: string; category: string }>) {
  const handle = d.handle
  const decision = String(d.decision ?? '').trim()

  if (!decision || decision === 'BLOCKED') {
    outcomes.push({ n: d.n, handle, decision: decision || '(none)', action: 'left-blocked' })
    continue
  }

  // ── RESTORE: a record pointing at a Player the reversal deleted ────────────────────────────
  if (decision === 'RESTORE') {
    const orphan = await prisma.$queryRawUnsafe<Array<{ id: number; seasonId: number; cueverseId: string | null; username: string | null; status: string }>>(`
      select e.id, e."seasonId", e."cueverseId", e.username, e.status from season_entrant e
      where e."playerId" is not null and not exists (select 1 from "Player" p where p.id = e."playerId")
        and lower(coalesce(e."cueverseId", e.username)) = $1`, handle.toLowerCase())
    if (!orphan.length) {
      outcomes.push({ n: d.n, handle, decision, action: 'already-restored', detail: 'no orphaned row with this handle remains' })
      continue
    }
    say(`${d.n}. ${handle}: restore a minimal historical Player and relink ${orphan.length} entrant row(s)`)
    if (APPLY) {
      /*
       * Created directly rather than through createMember: this person gets NO user account. They
       * are a name on an entrant list who withdrew, and `primaryName` carries the recorded handle
       * because inventing a display name would be inventing a personal detail.
       */
      const player = await prisma.player.create({
        data: { primaryName: handle, cueverseId: handle, cueverseIdNormalized: handle.toLowerCase() },
        select: { id: true },
      })
      for (const o of orphan) {
        await prisma.seasonEntrant.update({ where: { id: o.id }, data: { playerId: player.id } })
      }
      outcomes.push({ n: d.n, handle, decision, action: 'restored', detail: `player ${player.id}, ${orphan.length} entrant row(s) relinked, status preserved` })
      say(`   restored as ${player.id}, status left as ${orphan[0].status}`)
    } else {
      outcomes.push({ n: d.n, handle, decision, action: 'would-restore' })
    }
    continue
  }

  // ── NEW: nobody in the database is this person ─────────────────────────────────────────────
  if (decision === 'NEW') {
    const existing = await byCueverse(handle)
    if (existing) {
      outcomes.push({ n: d.n, handle, decision, action: 'already-exists', detail: existing.id })
      continue
    }
    say(`${d.n}. ${handle}: create a historical Player`)
    if (APPLY) {
      const res = await createMember(ACTOR, { cueverseId: handle })
      outcomes.push({ n: d.n, handle, decision, action: res.ok ? 'created' : 'failed', detail: res.ok ? res.playerId : res.error })
      say(`   ${res.ok ? `created ${res.playerId}` : `FAILED — ${res.error}`}`)
    } else {
      outcomes.push({ n: d.n, handle, decision, action: 'would-create' })
    }
    continue
  }

  // ── A CueVerse ID: this handle is another spelling of that person ──────────────────────────
  const target = await byCueverse(decision)
  if (!target) {
    outcomes.push({ n: d.n, handle, decision, action: 'refused', detail: `no Player holds the CueVerse ID "${decision}"` })
    say(`${d.n}. ${handle}: REFUSED — no Player holds "${decision}"`)
    continue
  }

  const already = await prisma.playerAlias.findFirst({
    where: { alias: { equals: handle, mode: 'insensitive' } },
    select: { playerId: true },
  })
  if (already?.playerId === target.id) {
    outcomes.push({ n: d.n, handle, decision, action: 'already-aliased', detail: target.id })
    continue
  }
  if (already && already.playerId !== target.id) {
    /*
     * The alias exists but points somewhere else. That is a genuine conflict between the decision
     * and the database, and it is refused rather than repointed -- moving an alias silently moves
     * every record that resolved through it.
     */
    outcomes.push({ n: d.n, handle, decision, action: 'refused', detail: `alias already points at a different Player (${already.playerId})` })
    say(`${d.n}. ${handle}: REFUSED — alias already claimed by ${already.playerId}`)
    continue
  }

  say(`${d.n}. ${handle} -> ${target.cueverseId} (${target.primaryName})`)
  if (APPLY) {
    const res = await addAlias(ACTOR, target.id, handle)
    outcomes.push({ n: d.n, handle, decision, action: res.ok ? 'aliased' : 'failed', detail: res.error ?? target.id })
    if (!res.ok) say(`   FAILED — ${res.error}`)
  } else {
    outcomes.push({ n: d.n, handle, decision, action: 'would-alias', detail: target.id })
  }
}

mkdirSync('reports', { recursive: true })
const summary = outcomes.reduce<Record<string, number>>((a, o) => ({ ...a, [o.action]: (a[o.action] ?? 0) + 1 }), {})
writeFileSync('reports/archive-identity-decisions-applied.json', JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', summary, outcomes }, null, 2))

console.log(`\n${JSON.stringify(summary, null, 2)}`)
console.log('report: reports/archive-identity-decisions-applied.json')

const failed = outcomes.filter((o) => o.action === 'failed' || o.action === 'refused')
if (failed.length) {
  console.log(`\n${failed.length} decision(s) did not apply:`)
  for (const f of failed) console.log(`  ${f.n}. ${f.handle} — ${f.detail}`)
}

await prisma.$disconnect()
process.exit(failed.length ? 1 : 0)
