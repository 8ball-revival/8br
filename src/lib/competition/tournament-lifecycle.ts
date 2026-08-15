import 'server-only'
import type { TournamentLifecycleState, Tournament, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'
import { validateRandomCount } from './random-teams'

/**
 * RANDOM close gate: a random-draw tournament may only close registration when its solo entrant
 * count forms complete teams (an exact multiple of team size) AND at least two teams. Returns an
 * error string (exactly how many to add/remove), else null. Enforced inside `transitionTournamentState`
 * so every close path — the button, auto-close, or a direct call — validates it identically.
 */
async function assertRandomClosable(tournamentId: number, teamSize: number): Promise<string | null> {
  const n = await prisma.registration.count({ where: { tournamentId, status: 'APPROVED', team: { is: null } } })
  const r = validateRandomCount(n, teamSize)
  return r.ok ? null : r.error
}

/**
 * CUP LIFECYCLE — the single source of truth for a tournament's state and the ONLY place cup state
 * transitions happen. Behavior is driven by the explicit stored `Tournament.lifecycleState`, never
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
 * Each transition also syncs the legacy fields (registrationStatus / status /
 * playoffsStatus / cupStatus) so existing readers keep working, and COMPLETED applies the
 * ladder exactly once (idempotent via `ladderAppliedAt`). Every transition is audited.
 */

export type TournamentState = TournamentLifecycleState // internal alias (kept to limit churn; not user-facing)

const NEXT: Record<TournamentState, TournamentState[]> = {
  DRAFT: ['REGISTRATION_OPEN', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  // Registration may be RE-OPENED (a first-class toggle, not a recovery) any time before the
  // tournament goes live. From Registration Closed a bracket-only tournament goes straight to
  // BRACKET_GENERATED; a Group Stage + Playoffs tournament first enters GROUPS_IN_PROGRESS.
  // A Swiss tournament goes straight to IN_PROGRESS (round-based play, no bracket).
  REGISTRATION_CLOSED: ['REGISTRATION_OPEN', 'GROUPS_IN_PROGRESS', 'BRACKET_GENERATED', 'IN_PROGRESS', 'CANCELLED'],
  // Group stage running; once groups finish, confirming qualifiers seeds + publishes the playoff
  // bracket and goes live (IN_PROGRESS) so playoff results can be reported immediately.
  GROUPS_IN_PROGRESS: ['REGISTRATION_OPEN', 'BRACKET_GENERATED', 'IN_PROGRESS', 'CANCELLED'],
  BRACKET_GENERATED: ['REGISTRATION_OPEN', 'GROUPS_IN_PROGRESS', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

/** Terminal states — no normal mutation of any kind is permitted (Owner recovery only). */
const TERMINAL: readonly TournamentState[] = ['COMPLETED', 'CANCELLED']
export function isTerminal(state: TournamentState): boolean {
  return TERMINAL.includes(state)
}

export function canTransition(from: TournamentState, to: TournamentState): boolean {
  return NEXT[from].includes(to)
}

export const TOURNAMENT_STATE_LABEL: Record<TournamentState, string> = {
  DRAFT: 'Draft',
  REGISTRATION_OPEN: 'Registration Open',
  REGISTRATION_CLOSED: 'Registration Closed',
  GROUPS_IN_PROGRESS: 'Group Stage',
  BRACKET_GENERATED: 'Bracket Generated',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

type TournamentStateFields = Pick<Tournament, 'lifecycleState' | 'status' | 'registrationStatus' | 'playoffsStatus'>

/**
 * Derive a lifecycle state for a legacy cup that predates the explicit field (pure).
 *
 * Migration behavior for existing cups (which have `lifecycleState = null`): the value is derived
 * on read from the old status columns and is never written until the tournament's next transition.
 *   - completed cup (`cupStatus=completed` or `status=COMPLETED`) → COMPLETED
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
export function deriveLegacyState(s: TournamentStateFields): TournamentState {
  if (s.lifecycleState) return s.lifecycleState
  if (s.status === 'COMPLETED') return 'COMPLETED'
  if (s.playoffsStatus === 'PUBLISHED') return 'IN_PROGRESS'
  if (s.registrationStatus === 'OPEN') return 'REGISTRATION_OPEN'
  if (s.registrationStatus === 'CLOSED') return 'REGISTRATION_CLOSED'
  return 'DRAFT'
}

/** Read the current state (explicit field, or derived for a not-yet-backfilled cup). */
export function getTournamentState(s: TournamentStateFields): TournamentState {
  return s.lifecycleState ?? deriveLegacyState(s)
}

/** Legacy-field updates that keep the old status columns consistent with a new state. */
function legacyFieldsFor(to: TournamentState): Prisma.TournamentUpdateInput {
  switch (to) {
    case 'DRAFT':
      return { registrationStatus: 'NOT_OPEN', status: 'UPCOMING' }
    case 'REGISTRATION_OPEN':
      return { registrationStatus: 'OPEN', status: 'UPCOMING' }
    case 'REGISTRATION_CLOSED':
      return { registrationStatus: 'CLOSED', status: 'UPCOMING' }
    case 'GROUPS_IN_PROGRESS':
      // Group stage running: groups published, playoff bracket not yet generated.
      return { registrationStatus: 'CLOSED', status: 'ACTIVE', groupsStatus: 'PUBLISHED' }
    case 'BRACKET_GENERATED':
      // Bracket is visible (PUBLISHED) but the tournament has NOT started (status stays UPCOMING).
      return { registrationStatus: 'CLOSED', status: 'UPCOMING', playoffsStatus: 'PUBLISHED' }
    case 'IN_PROGRESS':
      return { registrationStatus: 'CLOSED', status: 'ACTIVE', playoffsStatus: 'PUBLISHED' }
    case 'COMPLETED':
      return { registrationStatus: 'CLOSED', status: 'COMPLETED', playoffsStatus: 'COMPLETED' }
    case 'CANCELLED':
      return { registrationStatus: 'CLOSED', status: 'COMPLETED' }
  }
}

/**
 * Are all required matches resolved so the tournament can be COMPLETED? Returns an error string, or
 * null when completable. Requires a generated bracket, a Final with a confirmed winner, and no
 * playable (both-sides-known) match left undecided.
 */
export async function assertCompletable(tournamentId: number): Promise<string | null> {
  // Swiss has no bracket — it completes when every round has been paired and reported.
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { tournamentFormat: true, swissRounds: true } })
  if (t?.tournamentFormat === 'SWISS') {
    const sm = await prisma.swissMatch.findMany({ where: { tournamentId }, select: { round: true, isBye: true, winnerRegistrationId: true } })
    if (sm.length === 0) return 'The Swiss rounds have not started yet.'
    const maxRound = Math.max(...sm.map((m) => m.round))
    const total = t.swissRounds ?? 0
    if (total > 0 && maxRound < total) return `Play all ${total} Swiss rounds before finishing.`
    const undecided = sm.filter((m) => !m.isBye && m.winnerRegistrationId == null).length
    if (undecided > 0) return `${undecided} Swiss match${undecided === 1 ? '' : 'es'} still need${undecided === 1 ? 's' : ''} a result.`
    return null
  }

  const matches = await prisma.playoffMatch.findMany({
    where: { tournamentId },
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
 * Does the generated bracket still match the tournament's current active entrants? A bracket is built from
 * a fixed set of registration ids (byes fill the rest); if entrants are added/removed after it was
 * generated (e.g. registration was re-opened), the bracket is stale and must be regenerated before
 * the tournament can start. Returns { ok } plus the two id sets for messaging. Team cups compare team
 * registration ids the same way.
 */
export async function bracketMatchesEntrants(tournamentId: number): Promise<{ ok: boolean; reason?: string }> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { tournamentFormat: true } })
  const matches = await prisma.playoffMatch.findMany({
    where: { tournamentId },
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
  const regs = await prisma.registration.findMany({ where: { tournamentId, status: { not: 'WITHDRAWN' } }, select: { id: true } })
  const active = new Set(regs.map((r) => r.id))
  // A seeded id no longer active → stale (a qualifier/entrant left after seeding).
  for (const id of seeded) if (!active.has(id)) return { ok: false, reason: 'The bracket includes an entrant who is no longer in the tournament.' }
  // For Group Stage + Playoffs the bracket holds only the qualifiers (top-N), so non-qualifying
  // entrants are legitimately absent — skip the "everyone must be seeded" reverse check there.
  if (tournament?.tournamentFormat !== 'GROUPS_PLAYOFFS') {
    for (const id of active) if (!seeded.has(id)) return { ok: false, reason: 'An entrant was added after the bracket was generated.' }
  }
  return { ok: true }
}

export interface TransitionResult {
  ok: boolean
  error?: string
  from?: TournamentState
  to?: TournamentState
}

/**
 * Transition a tournament to a new state. `recovery` (OWNER-gated by the caller) permits an otherwise
 * invalid move and is audited distinctly. Applies legacy-field sync, completion validation on
 * COMPLETED (unless recovery), and the idempotent ladder update, all transactionally + audited.
 */
export async function transitionTournamentState(
  actor: Actor,
  tournamentId: number,
  to: TournamentState,
  opts: { reason?: string; recovery?: boolean } = {},
): Promise<TransitionResult> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!tournament) return { ok: false, error: 'Tournament not found.' }

  const from = getTournamentState(tournament)
  if (from === to) return { ok: true, from, to }

  const valid = canTransition(from, to)
  if (!valid && !opts.recovery)
    return { ok: false, error: `Invalid transition: ${TOURNAMENT_STATE_LABEL[from]} → ${TOURNAMENT_STATE_LABEL[to]}. Use a recovery action if this is intentional.` }

  // Format guard: the direct REGISTRATION_CLOSED → IN_PROGRESS transition exists ONLY for Swiss
  // (round-based, no bracket). A bracket / group-stage tournament must generate its bracket (or
  // start groups) first — it can never skip straight to live.
  if (from === 'REGISTRATION_CLOSED' && to === 'IN_PROGRESS' && !opts.recovery && tournament.tournamentFormat !== 'SWISS') {
    return { ok: false, error: 'Generate the bracket (or start the group stage) before the tournament goes live.' }
  }

  const isRandom = tournament.participantFormat === 'TEAM' && tournament.teamFormation === 'RANDOM'

  // RANDOM close gate — never close into an entrant count that can't form complete teams.
  if (to === 'REGISTRATION_CLOSED' && isRandom && !opts.recovery) {
    const problem = await assertRandomClosable(tournamentId, tournament.teamSize ?? 2)
    if (problem) return { ok: false, error: problem }
  }

  // RANDOM lock: registration cannot be RE-OPENED once closed (teams are drawn once and locked).
  // (`from === DRAFT` is the initial open, which stays allowed.)
  if (to === 'REGISTRATION_OPEN' && from !== 'DRAFT' && isRandom && !opts.recovery) {
    return { ok: false, error: 'Random-draw tournaments cannot reopen registration once it has closed.' }
  }

  // Completion gate — the Final must be decided and no required match left open.
  if (to === 'COMPLETED' && !opts.recovery) {
    const problem = await assertCompletable(tournamentId)
    if (problem) return { ok: false, error: problem }
  }

  await prisma.$transaction(async (tx) => {
    await tx.tournament.update({ where: { id: tournamentId }, data: { lifecycleState: to, ...legacyFieldsFor(to) } })
    await recordAudit(
      actor,
      { action: opts.recovery && !valid ? 'tournament.state.recovery' : 'tournament.state', entity: 'Tournament', entityId: tournamentId, oldValue: { state: from }, newValue: { state: to }, reason: opts.reason },
      tx,
    )
    if (to === 'COMPLETED') {
      await applyLadder(tx, tournamentId, actor)
      // Deterministically (re)build the Elo rating ledger from every completed tournament in close
      // order. Idempotent — a normal close, a retry, and an authorized correction all converge on the
      // same correct state, and downstream ratings are always replayed chronologically.
      const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
      await rebuildRatingLedger(tx)
    }
  })

  // Reflect the final bracket/champion into the derived snapshot (rankings/records/list).
  const { syncLiveTournamentToSnapshot } = await import('./tournament-sync')
  await syncLiveTournamentToSnapshot(tournamentId)
  return { ok: true, from, to }
}

type Tx = Prisma.TransactionClient

/**
 * Apply the ladder/ranking update for a completed cup EXACTLY ONCE (idempotent via
 * `ladderAppliedAt`). The ladder is a pure function of cup results (recomputed from the
 * regenerated snapshot), so re-running is harmless — the timestamp + audit make "applied once"
 * explicit and mean reopening/re-completing never double-applies.
 */
export async function applyLadder(tx: Tx, tournamentId: number, actor: Actor): Promise<void> {
  const s = await tx.tournament.findUnique({ where: { id: tournamentId }, select: { ladderAppliedAt: true } })
  if (!s || s.ladderAppliedAt) return // already applied — do not run twice
  await tx.tournament.update({ where: { id: tournamentId }, data: { ladderAppliedAt: new Date() } })
  await recordAudit(actor, { action: 'tournament.ladder.apply', entity: 'Tournament', entityId: tournamentId, newValue: { appliedAt: new Date().toISOString() } }, tx)
}

/**
 * Server-side gate: assert a tournament is currently in one of `allowed` states before a mutation.
 * This is the authoritative check — the UI hiding a control is never relied upon. Terminal states
 * (Completed/Cancelled) get a clear "locked" message so every normal mutation is refused server-side.
 */
export async function requireTournamentState(
  tournamentId: number,
  allowed: TournamentState[],
): Promise<{ ok: true; state: TournamentState } | { ok: false; error: string }> {
  const s = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { lifecycleState: true, status: true, registrationStatus: true, playoffsStatus: true },
  })
  if (!s) return { ok: false, error: 'Tournament not found.' }
  const state = getTournamentState(s)
  if (allowed.includes(state)) return { ok: true, state }
  if (state === 'COMPLETED') return { ok: false, error: 'This tournament is completed and locked — no further changes are allowed (Owner recovery only).' }
  if (state === 'CANCELLED') return { ok: false, error: 'This tournament has been cancelled.' }
  return { ok: false, error: `Not allowed while the tournament is "${TOURNAMENT_STATE_LABEL[state]}".` }
}

// ---- TournamentView history (derived from the audit log) -----------------------------

export type TournamentHistoryKind =
  | 'created' | 'registration_open' | 'registration_closed'
  | 'bracket_generated' | 'bracket_regenerated' | 'tournament_started' | 'teams_generated'
  | 'match_result' | 'entrant_added' | 'entrant_removed' | 'ladder_applied'
  | 'tournament_completed' | 'tournament_cancelled' | 'recovery' | 'other'

export interface TournamentHistoryEvent {
  at: string // ISO timestamp
  kind: TournamentHistoryKind
  label: string // public-safe description
  actor?: string // admin view only
  detail?: string // admin view only (e.g. recovery reason)
}

const PUBLIC_KINDS: ReadonlySet<TournamentHistoryKind> = new Set([
  'created', 'registration_open', 'registration_closed', 'bracket_generated', 'bracket_regenerated',
  'tournament_started', 'teams_generated', 'match_result', 'tournament_completed', 'tournament_cancelled', 'recovery',
])

/**
 * Build a chronological cup history from the immutable audit log (reusing the existing system, not a
 * duplicate source). Public callers get a simplified, non-sensitive projection (no actor names, no
 * reasons/notes, no admin-only bookkeeping like entrant edits or ladder application). Admins/Moderators
 * with `view_audit`-style access get the fuller version including actor and reason. Private moderation
 * notes, emails, and account internals never appear here — cup audit rows contain none of those.
 */
export async function getTournamentHistory(tournamentId: number, opts: { admin?: boolean } = {}): Promise<TournamentHistoryEvent[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entity: 'Tournament', entityId: String(tournamentId) },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, action: true, actorUsername: true, oldValue: true, newValue: true, reason: true },
  })

  const events: TournamentHistoryEvent[] = []
  let sawBracketGenerated = false
  const stateOf = (v: unknown): TournamentState | null => {
    const s = v && typeof v === 'object' ? (v as Record<string, unknown>).state : null
    return typeof s === 'string' ? (s as TournamentState) : null
  }

  for (const r of rows) {
    const at = r.createdAt.toISOString()
    const actor = r.actorUsername
    const reason = r.reason ?? undefined
    const push = (kind: TournamentHistoryKind, label: string, detail?: string) => events.push({ at, kind, label, actor, detail })

    switch (r.action) {
      case 'tournament.create':
        push('created', 'Tournament created')
        break
      case 'tournament.state': {
        const to = stateOf(r.newValue)
        if (to === 'REGISTRATION_OPEN') push('registration_open', 'Registration opened')
        else if (to === 'REGISTRATION_CLOSED') push('registration_closed', 'Registration closed')
        else if (to === 'BRACKET_GENERATED') { push('bracket_generated', 'Bracket generated'); sawBracketGenerated = true }
        else if (to === 'IN_PROGRESS') push('tournament_started', 'Tournament started')
        else if (to === 'COMPLETED') push('tournament_completed', 'Tournament completed')
        else if (to === 'CANCELLED') push('tournament_cancelled', 'Tournament cancelled')
        break
      }
      case 'tournament.state.recovery': {
        const to = stateOf(r.newValue)
        push('recovery', `Recovery action${to ? ` → ${TOURNAMENT_STATE_LABEL[to] ?? to}` : ''}`, reason)
        break
      }
      case 'playoff.manualBuild':
        // The initial build precedes the BRACKET_GENERATED milestone (which represents "generated");
        // only builds AFTER that milestone are regenerations worth surfacing.
        if (sawBracketGenerated) push('bracket_regenerated', 'Bracket regenerated')
        break
      case 'tournament.team.randomDraw': {
        // The one-time random team draw. Public sees the milestone; admins additionally see the names.
        const nv = r.newValue && typeof r.newValue === 'object' ? (r.newValue as Record<string, unknown>) : {}
        const teams = typeof nv.teams === 'number' ? nv.teams : undefined
        const names = Array.isArray(nv.names) ? (nv.names as unknown[]).filter((x): x is string => typeof x === 'string') : []
        push('teams_generated', teams != null ? `Random teams generated (${teams})` : 'Random teams generated', names.length ? names.join(', ') : undefined)
        break
      }
      case 'playoff.verify':
        push('match_result', 'Match result recorded')
        break
      case 'tournament.ladder.apply':
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
export async function backfillTournamentState(tournamentId: number): Promise<TournamentState> {
  const s = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { lifecycleState: true, status: true, registrationStatus: true, playoffsStatus: true } })
  if (!s) return 'DRAFT'
  if (s.lifecycleState) return s.lifecycleState
  const derived = deriveLegacyState(s)
  await prisma.tournament.update({ where: { id: tournamentId }, data: { lifecycleState: derived } })
  return derived
}
