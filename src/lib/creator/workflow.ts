import 'server-only'

/**
 * The Creator workflow: which stages a record has, and where it currently is.
 *
 * ── One model, two record types ──────────────────────────────────────────────────────────────────
 * A Season and a Tournament are different things and stay different rows, but the SHAPE of running
 * one is the same: set it up, get the people in, play the stage that decides who advances, play the
 * bracket, finish it. Describing that once means the shell, the navigation, the guards and the tests
 * all agree about what "the Groups stage" means, instead of four files each deciding for themselves.
 *
 * ── Stages come from the format, not from a menu ─────────────────────────────────────────────────
 * A single-elimination Tournament has no group stage and a Swiss one has no bracket, so those stages
 * do not exist for those records — they are absent rather than disabled. A stage that cannot ever
 * apply should not be a thing the reader has to learn to ignore.
 */

export type RecordKind = 'season' | 'tournament'

export type StageId = 'setup' | 'entrants' | 'groups' | 'swiss' | 'playoffs' | 'complete'

export interface Stage {
  id: StageId
  label: string
  /** Path segment under /creator/{kind}s/{id}. */
  segment: string
}

const STAGE: Record<StageId, Stage> = {
  setup: { id: 'setup', label: 'Setup', segment: 'setup' },
  entrants: { id: 'entrants', label: 'Entrants', segment: 'entrants' },
  groups: { id: 'groups', label: 'Groups', segment: 'groups' },
  swiss: { id: 'swiss', label: 'Swiss Rounds', segment: 'swiss' },
  playoffs: { id: 'playoffs', label: 'Playoffs', segment: 'playoffs' },
  complete: { id: 'complete', label: 'Complete', segment: 'complete' },
}

/** Tournament formats, as stored on `Tournament.tournamentFormat`. */
export type TournamentFormat = 'SINGLE_ELIM' | 'DOUBLE_ELIM' | 'GROUPS_PLAYOFFS' | 'SWISS'

/**
 * The stages this record actually has.
 *
 * A Season always runs groups into a bracket — the two structures on offer differ only in the
 * bracket's elimination rule, which changes how the playoff stage plays and not which stages exist.
 */
export function stagesFor(kind: RecordKind, format?: string | null): Stage[] {
  if (kind === 'season') {
    return [STAGE.setup, STAGE.entrants, STAGE.groups, STAGE.playoffs, STAGE.complete]
  }
  switch ((format ?? 'SINGLE_ELIM') as TournamentFormat) {
    case 'SWISS':
      return [STAGE.setup, STAGE.entrants, STAGE.swiss, STAGE.complete]
    case 'GROUPS_PLAYOFFS':
      return [STAGE.setup, STAGE.entrants, STAGE.groups, STAGE.playoffs, STAGE.complete]
    default:
      return [STAGE.setup, STAGE.entrants, STAGE.playoffs, STAGE.complete]
  }
}

/**
 * Which stage a lifecycle state belongs to.
 *
 * Deliberately total: an unrecognised state answers `setup` rather than throwing, because a record
 * in a state nobody planned for should still open somewhere a person can look at it.
 */
export function currentStage(kind: RecordKind, lifecycleState: string, format?: string | null): StageId {
  if (kind === 'season') {
    switch (lifecycleState) {
      case 'REGISTRATION_SCHEDULED':
      case 'REGISTRATION_OPEN': return 'entrants'
      /*
       * Registration Closed belongs to GROUPS, not to Entrants.
       *
       * The entrant list is settled by then and the only work left is the draw, so sending somebody
       * back to Entrants offers them a locked list and no way forward. Closing normally moves
       * straight through this state to GROUP_SETUP; a Season that stops here did so because the
       * second half of that step failed, and the group board is exactly where it needs to resume.
       */
      case 'REGISTRATION_CLOSED':
      case 'GROUP_SETUP':
      case 'GROUP_STAGE_LIVE':
      case 'GROUPS_CLOSED': return 'groups'
      case 'PLAYOFF_SETUP':
      case 'PLAYOFFS_LIVE': return 'playoffs'
      case 'COMPLETED': return 'complete'
      default: return 'setup'
    }
  }
  const f = (format ?? 'SINGLE_ELIM') as TournamentFormat
  switch (lifecycleState) {
    case 'DRAFT': return 'setup'
    case 'REGISTRATION_OPEN':
    case 'REGISTRATION_CLOSED': return 'entrants'
    case 'GROUPS_IN_PROGRESS': return 'groups'
    case 'BRACKET_GENERATED': return f === 'SWISS' ? 'swiss' : 'playoffs'
    case 'IN_PROGRESS': return f === 'SWISS' ? 'swiss' : 'playoffs'
    case 'COMPLETED': return 'complete'
    default: return 'setup'
  }
}

export type StageStatus = 'done' | 'current' | 'open' | 'locked'

export interface StageView extends Stage {
  status: StageStatus
  href: string
}

/**
 * The workflow bar.
 *
 * Everything before the current stage is `done` and remains reachable, because correcting an earlier
 * stage is a normal part of reconstructing a record and the confirmation for it lives on the stage
 * itself. Everything after is `locked`: offering a link to a bracket for a Season that has not
 * decided who is in it produces a page that can only apologise.
 */
export function workflowFor(
  kind: RecordKind,
  id: number,
  lifecycleState: string,
  format?: string | null,
): StageView[] {
  const stages = stagesFor(kind, format)
  const current = currentStage(kind, lifecycleState, format)
  const currentIndex = Math.max(0, stages.findIndex((s) => s.id === current))
  const base = `/creator/${kind}s/${id}`

  return stages.map((s, i) => ({
    ...s,
    href: `${base}/${s.segment}`,
    status:
      lifecycleState === 'COMPLETED' && s.id === 'complete' ? 'current'
      : i < currentIndex ? 'done'
      : i === currentIndex ? 'current'
      : 'locked',
  }))
}

/** Whether a stage may be opened for this record right now. */
export function stageReachable(
  kind: RecordKind,
  lifecycleState: string,
  stage: StageId,
  format?: string | null,
): boolean {
  const view = workflowFor(kind, 0, lifecycleState, format)
  const s = view.find((v) => v.id === stage)
  return !!s && s.status !== 'locked'
}
