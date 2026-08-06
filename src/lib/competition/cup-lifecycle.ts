import 'server-only'
import type { CupLifecycleState, Season, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'

/**
 * CUP LIFECYCLE — the single source of truth for a cup's state and the ONLY place cup state
 * transitions happen. Behavior is driven by the explicit stored `Season.cupState`, never
 * inferred from whether a bracket exists.
 *
 * Valid transitions (enforced server-side):
 *   DRAFT → REGISTRATION_OPEN → REGISTRATION_CLOSED → BRACKET_GENERATED → IN_PROGRESS → COMPLETED
 *   (any active state) → CANCELLED
 * Generating the bracket moves REGISTRATION_CLOSED → BRACKET_GENERATED (the bracket is visible but
 * the tournament has NOT begun: no reporting/scoring, admins may still review + regenerate).
 * A separate, explicit "Begin tournament" then moves BRACKET_GENERATED → IN_PROGRESS.
 * Any other move (skip/backwards, e.g. reopening a completed cup) requires an explicit
 * OWNER recovery (`recovery: true`) and is audited as such.
 *
 * Each transition also syncs the legacy fields (registrationStatus / seasonStatus /
 * playoffsStatus / cupStatus) so existing readers keep working, and COMPLETED applies the
 * ladder exactly once (idempotent via `ladderAppliedAt`). Every transition is audited.
 */

export type CupState = CupLifecycleState

const NEXT: Record<CupState, CupState[]> = {
  DRAFT: ['REGISTRATION_OPEN', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  // Registration may be RE-OPENED (a first-class toggle, not a recovery) any time before the cup
  // goes live — from Registration Closed, or from Bracket Generated (which invalidates the bracket).
  REGISTRATION_CLOSED: ['REGISTRATION_OPEN', 'BRACKET_GENERATED', 'CANCELLED'],
  BRACKET_GENERATED: ['REGISTRATION_OPEN', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

/** Terminal states — no normal mutation of any kind is permitted (Owner recovery only). */
const TERMINAL: readonly CupState[] = ['COMPLETED', 'CANCELLED']
export function isTerminal(state: CupState): boolean {
  return TERMINAL.includes(state)
}

export function canTransition(from: CupState, to: CupState): boolean {
  return NEXT[from].includes(to)
}

export const CUP_STATE_LABEL: Record<CupState, string> = {
  DRAFT: 'Draft',
  REGISTRATION_OPEN: 'Registration Open',
  REGISTRATION_CLOSED: 'Registration Closed',
  BRACKET_GENERATED: 'Bracket Generated',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

type SeasonStateFields = Pick<Season, 'cupState' | 'cupStatus' | 'seasonStatus' | 'registrationStatus' | 'playoffsStatus'>

/**
 * Derive a lifecycle state for a legacy cup that predates the explicit field (pure).
 *
 * Migration behavior for existing cups (which have `cupState = null`): the value is derived
 * on read from the old status columns and is never written until the cup's next transition.
 *   - completed cup (`cupStatus=completed` or `seasonStatus=COMPLETED`) → COMPLETED
 *   - published bracket (`playoffsStatus=PUBLISHED`) → IN_PROGRESS
 *   - registration OPEN / CLOSED → REGISTRATION_OPEN / REGISTRATION_CLOSED
 *   - otherwise → DRAFT
 *
 * NOTE on BRACKET_GENERATED: legacy cups have no notion of "bracket published but tournament not
 * yet begun" — under the old model a published bracket WAS a running tournament. So a legacy cup
 * with a published-but-incomplete bracket derives to IN_PROGRESS (the safe, behavior-preserving
 * choice: reporting/scoring stay enabled, exactly as before). BRACKET_GENERATED is only ever
 * reached by cups managed under the new flow, where it is stored explicitly.
 */
export function deriveLegacyState(s: SeasonStateFields): CupState {
  if (s.cupState) return s.cupState
  if (s.cupStatus === 'completed' || s.seasonStatus === 'COMPLETED') return 'COMPLETED'
  if (s.playoffsStatus === 'PUBLISHED') return 'IN_PROGRESS'
  if (s.registrationStatus === 'OPEN') return 'REGISTRATION_OPEN'
  if (s.registrationStatus === 'CLOSED') return 'REGISTRATION_CLOSED'
  return 'DRAFT'
}

/** Read the current state (explicit field, or derived for a not-yet-backfilled cup). */
export function getCupState(s: SeasonStateFields): CupState {
  return s.cupState ?? deriveLegacyState(s)
}

/** Legacy-field updates that keep the old status columns consistent with a new state. */
function legacyFieldsFor(to: CupState): Prisma.SeasonUpdateInput {
  switch (to) {
    case 'DRAFT':
      return { registrationStatus: 'NOT_OPEN', seasonStatus: 'UPCOMING', cupStatus: 'live' }
    case 'REGISTRATION_OPEN':
      return { registrationStatus: 'OPEN', seasonStatus: 'UPCOMING', cupStatus: 'live' }
    case 'REGISTRATION_CLOSED':
      return { registrationStatus: 'CLOSED', seasonStatus: 'UPCOMING', cupStatus: 'live' }
    case 'BRACKET_GENERATED':
      // Bracket is visible (PUBLISHED) but the tournament has NOT started (seasonStatus stays UPCOMING).
      return { registrationStatus: 'CLOSED', seasonStatus: 'UPCOMING', playoffsStatus: 'PUBLISHED', cupStatus: 'live' }
    case 'IN_PROGRESS':
      return { registrationStatus: 'CLOSED', seasonStatus: 'ACTIVE', playoffsStatus: 'PUBLISHED', cupStatus: 'live' }
    case 'COMPLETED':
      return { registrationStatus: 'CLOSED', seasonStatus: 'COMPLETED', playoffsStatus: 'COMPLETED', cupStatus: 'completed' }
    case 'CANCELLED':
      return { registrationStatus: 'CLOSED', seasonStatus: 'COMPLETED', cupStatus: 'cancelled' }
  }
}

/**
 * Are all required matches resolved so the cup can be COMPLETED? Returns an error string, or
 * null when completable. Requires a generated bracket, a Final with a confirmed winner, and no
 * playable (both-sides-known) match left undecided.
 */
export async function assertCompletable(seasonId: number): Promise<string | null> {
  const matches = await prisma.playoffMatch.findMany({
    where: { seasonId },
    select: { round: true, homeRegistrationId: true, awayRegistrationId: true, winnerRegistrationId: true },
  })
  if (matches.length === 0) return 'No bracket has been generated yet.'
  const maxRound = Math.max(...matches.map((m) => m.round))
  const finals = matches.filter((m) => m.round === maxRound)
  if (!finals.some((m) => m.winnerRegistrationId != null)) return 'The Final does not have a confirmed winner yet.'
  const undecided = matches.filter((m) => m.homeRegistrationId != null && m.awayRegistrationId != null && m.winnerRegistrationId == null)
  if (undecided.length > 0) return `${undecided.length} required match${undecided.length === 1 ? '' : 'es'} still need${undecided.length === 1 ? 's' : ''} a result.`
  return null
}

/**
 * Does the generated bracket still match the cup's current active entrants? A bracket is built from
 * a fixed set of registration ids (byes fill the rest); if entrants are added/removed after it was
 * generated (e.g. registration was re-opened), the bracket is stale and must be regenerated before
 * the cup can start. Returns { ok } plus the two id sets for messaging. Team cups compare team
 * registration ids the same way.
 */
export async function bracketMatchesEntrants(seasonId: number): Promise<{ ok: boolean; reason?: string }> {
  const matches = await prisma.playoffMatch.findMany({
    where: { seasonId },
    select: { round: true, homeRegistrationId: true, awayRegistrationId: true },
  })
  if (matches.length === 0) return { ok: false, reason: 'No bracket has been generated.' }
  const minRound = Math.min(...matches.map((m) => m.round))
  const seeded = new Set<number>()
  for (const m of matches.filter((m) => m.round === minRound)) {
    if (m.homeRegistrationId != null) seeded.add(m.homeRegistrationId)
    if (m.awayRegistrationId != null) seeded.add(m.awayRegistrationId)
  }
  // Current active entrants: non-withdrawn registrations, or (team cups) non-withdrawn teams' regs.
  const regs = await prisma.registration.findMany({ where: { seasonId, status: { not: 'WITHDRAWN' } }, select: { id: true } })
  const active = new Set(regs.map((r) => r.id))
  // A seeded id no longer active, or an active entrant missing from the bracket → stale.
  for (const id of seeded) if (!active.has(id)) return { ok: false, reason: 'The bracket includes an entrant who is no longer in the cup.' }
  for (const id of active) if (!seeded.has(id)) return { ok: false, reason: 'An entrant was added after the bracket was generated.' }
  return { ok: true }
}

export interface TransitionResult {
  ok: boolean
  error?: string
  from?: CupState
  to?: CupState
}

/**
 * Transition a cup to a new state. `recovery` (OWNER-gated by the caller) permits an otherwise
 * invalid move and is audited distinctly. Applies legacy-field sync, completion validation on
 * COMPLETED (unless recovery), and the idempotent ladder update, all transactionally + audited.
 */
export async function transitionCupState(
  actor: Actor,
  seasonId: number,
  to: CupState,
  opts: { reason?: string; recovery?: boolean } = {},
): Promise<TransitionResult> {
  const season = await prisma.season.findUnique({ where: { id: seasonId } })
  if (!season || season.competitionType !== 'CUP') return { ok: false, error: 'Cup not found.' }
  if (season.locked || season.importedFromFixture) return { ok: false, error: 'Imported/locked historical cups cannot change state.' }

  const from = getCupState(season)
  if (from === to) return { ok: true, from, to }

  const valid = canTransition(from, to)
  if (!valid && !opts.recovery)
    return { ok: false, error: `Invalid transition: ${CUP_STATE_LABEL[from]} → ${CUP_STATE_LABEL[to]}. Use a recovery action if this is intentional.` }

  // Completion gate — the Final must be decided and no required match left open.
  if (to === 'COMPLETED' && !opts.recovery) {
    const problem = await assertCompletable(seasonId)
    if (problem) return { ok: false, error: problem }
  }

  await prisma.$transaction(async (tx) => {
    await tx.season.update({ where: { id: seasonId }, data: { cupState: to, ...legacyFieldsFor(to) } })
    await recordAudit(
      actor,
      { action: opts.recovery && !valid ? 'cup.state.recovery' : 'cup.state', entity: 'Season', entityId: seasonId, oldValue: { state: from }, newValue: { state: to }, reason: opts.reason },
      tx,
    )
    if (to === 'COMPLETED') await applyLadder(tx, seasonId, actor)
  })

  // Reflect the final bracket/champion into the derived snapshot (rankings/records/list).
  const { syncLiveCupToSnapshot } = await import('./cup-sync')
  await syncLiveCupToSnapshot(seasonId)
  return { ok: true, from, to }
}

type Tx = Prisma.TransactionClient

/**
 * Apply the ladder/ranking update for a completed cup EXACTLY ONCE (idempotent via
 * `ladderAppliedAt`). The ladder is a pure function of cup results (recomputed from the
 * regenerated snapshot), so re-running is harmless — the timestamp + audit make "applied once"
 * explicit and mean reopening/re-completing never double-applies.
 */
export async function applyLadder(tx: Tx, seasonId: number, actor: Actor): Promise<void> {
  const s = await tx.season.findUnique({ where: { id: seasonId }, select: { ladderAppliedAt: true, cupYear: true, cupDate: true } })
  if (!s || s.ladderAppliedAt) return // already applied — do not run twice
  await tx.season.update({
    where: { id: seasonId },
    data: {
      ladderAppliedAt: new Date(),
      // Ensure the cup carries a year/date so results land in the rolling ranking window.
      ...(s.cupYear == null ? { cupYear: new Date().getFullYear() } : {}),
      ...(s.cupDate == null ? { cupDate: new Date().toISOString().slice(0, 10) } : {}),
    },
  })
  await recordAudit(actor, { action: 'cup.ladder.apply', entity: 'Season', entityId: seasonId, newValue: { appliedAt: new Date().toISOString() } }, tx)
}

/**
 * Server-side gate: assert a cup is currently in one of `allowed` states before a mutation.
 * This is the authoritative check — the UI hiding a control is never relied upon. Terminal states
 * (Completed/Cancelled) get a clear "locked" message so every normal mutation is refused server-side.
 */
export async function requireCupState(
  seasonId: number,
  allowed: CupState[],
): Promise<{ ok: true; state: CupState } | { ok: false; error: string }> {
  const s = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { competitionType: true, cupState: true, cupStatus: true, seasonStatus: true, registrationStatus: true, playoffsStatus: true },
  })
  if (!s || s.competitionType !== 'CUP') return { ok: false, error: 'Cup not found.' }
  const state = getCupState(s)
  if (allowed.includes(state)) return { ok: true, state }
  if (state === 'COMPLETED') return { ok: false, error: 'This cup is completed and locked — no further changes are allowed (Owner recovery only).' }
  if (state === 'CANCELLED') return { ok: false, error: 'This cup has been cancelled.' }
  return { ok: false, error: `Not allowed while the cup is "${CUP_STATE_LABEL[state]}".` }
}

// ---- Cup history (derived from the audit log) -----------------------------

export type CupHistoryKind =
  | 'created' | 'registration_open' | 'registration_closed'
  | 'bracket_generated' | 'bracket_regenerated' | 'tournament_started'
  | 'match_result' | 'entrant_added' | 'entrant_removed' | 'ladder_applied'
  | 'tournament_completed' | 'tournament_cancelled' | 'recovery' | 'other'

export interface CupHistoryEvent {
  at: string // ISO timestamp
  kind: CupHistoryKind
  label: string // public-safe description
  actor?: string // admin view only
  detail?: string // admin view only (e.g. recovery reason)
}

const PUBLIC_KINDS: ReadonlySet<CupHistoryKind> = new Set([
  'created', 'registration_open', 'registration_closed', 'bracket_generated', 'bracket_regenerated',
  'tournament_started', 'match_result', 'tournament_completed', 'tournament_cancelled', 'recovery',
])

/**
 * Build a chronological cup history from the immutable audit log (reusing the existing system, not a
 * duplicate source). Public callers get a simplified, non-sensitive projection (no actor names, no
 * reasons/notes, no admin-only bookkeeping like entrant edits or ladder application). Admins/Moderators
 * with `view_audit`-style access get the fuller version including actor and reason. Private moderation
 * notes, emails, and account internals never appear here — cup audit rows contain none of those.
 */
export async function getCupHistory(seasonId: number, opts: { admin?: boolean } = {}): Promise<CupHistoryEvent[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entity: 'Season', entityId: String(seasonId) },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, action: true, actorUsername: true, oldValue: true, newValue: true, reason: true },
  })

  const events: CupHistoryEvent[] = []
  let sawBracketGenerated = false
  const stateOf = (v: unknown): CupState | null => {
    const s = v && typeof v === 'object' ? (v as Record<string, unknown>).state : null
    return typeof s === 'string' ? (s as CupState) : null
  }

  for (const r of rows) {
    const at = r.createdAt.toISOString()
    const actor = r.actorUsername
    const reason = r.reason ?? undefined
    const push = (kind: CupHistoryKind, label: string, detail?: string) => events.push({ at, kind, label, actor, detail })

    switch (r.action) {
      case 'cup.create':
        push('created', 'Cup created')
        break
      case 'cup.state': {
        const to = stateOf(r.newValue)
        if (to === 'REGISTRATION_OPEN') push('registration_open', 'Registration opened')
        else if (to === 'REGISTRATION_CLOSED') push('registration_closed', 'Registration closed')
        else if (to === 'BRACKET_GENERATED') { push('bracket_generated', 'Bracket generated'); sawBracketGenerated = true }
        else if (to === 'IN_PROGRESS') push('tournament_started', 'Tournament started')
        else if (to === 'COMPLETED') push('tournament_completed', 'Tournament completed')
        else if (to === 'CANCELLED') push('tournament_cancelled', 'Tournament cancelled')
        break
      }
      case 'cup.state.recovery': {
        const to = stateOf(r.newValue)
        push('recovery', `Recovery action${to ? ` → ${CUP_STATE_LABEL[to] ?? to}` : ''}`, reason)
        break
      }
      case 'playoff.manualBuild':
        // The initial build precedes the BRACKET_GENERATED milestone (which represents "generated");
        // only builds AFTER that milestone are regenerations worth surfacing.
        if (sawBracketGenerated) push('bracket_regenerated', 'Bracket regenerated')
        break
      case 'playoff.verify':
        push('match_result', 'Match result recorded')
        break
      case 'cup.ladder.apply':
        push('ladder_applied', 'Ladder results applied', reason)
        break
      case 'entrant.add':
      case 'entrant.addManual':
        push('entrant_added', 'Entrant added')
        break
      case 'entrant.remove':
        push('entrant_removed', 'Entrant withdrawn')
        break
      default:
        break // other audit rows (reseed, notes, publish/return-to-draft, etc.) are not surfaced as history
    }
  }

  const filtered = opts.admin ? events : events.filter((e) => PUBLIC_KINDS.has(e.kind))
  // Public view: strip actor + detail so no admin identity or reason text leaks.
  return opts.admin ? filtered : filtered.map((e) => ({ at: e.at, kind: e.kind, label: e.label }))
}

/** Lazily persist a derived state for a legacy cup (safe backfill on first workspace load). */
export async function backfillCupState(seasonId: number): Promise<CupState> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { cupState: true, cupStatus: true, seasonStatus: true, registrationStatus: true, playoffsStatus: true } })
  if (!s) return 'DRAFT'
  if (s.cupState) return s.cupState
  const derived = deriveLegacyState(s)
  await prisma.season.update({ where: { id: seasonId }, data: { cupState: derived } })
  return derived
}
