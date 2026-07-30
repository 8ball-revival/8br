import { Badge } from '@/components/ui/badge'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SIGNAL_LABEL: Record<string, string> = {
  matching_ym: 'Matching YM identifier',
  matching_email: 'Matching email',
  overlapping_active_seasons: 'Overlapping active seasons',
  non_overlapping_usage: 'Non-overlapping historical usage',
  existing_merge_evidence: 'Existing merge evidence',
  existing_split_evidence: 'Existing split evidence',
  name_similarity_only: 'Name similarity only',
}
const DIAG_LABEL: Record<string, string> = {
  winner_field_may_be_reversed: 'Winner field may be reversed',
  score_may_be_reversed: 'Score may be reversed',
  possible_forfeit_or_admin_ruling: 'Possible forfeit / administrative ruling',
  missing_score: 'Missing score',
  bye_or_walkover_candidate: 'Bye or walkover candidate',
  unclear_legacy_format: 'Unclear legacy format',
}

function PlayerCompareCard({ p }: { p: any }) {
  return (
    <div className="rounded-md border border-border bg-card p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-display text-sm font-semibold">{p.primaryName}</span>
        <span className="tabular text-muted-foreground">{p.canonicalId}</span>
      </div>
      <dl className="mt-2 space-y-0.5 text-muted-foreground">
        <div>Aliases: {p.aliasCount} {p.aliases?.length ? `(${p.aliases.slice(0, 5).join(', ')}${p.aliasCount > 5 ? '…' : ''})` : ''}</div>
        <div>Competitions: {p.competitionCount}</div>
        <div>Active: {p.firstYear ?? '—'}–{p.lastYear ?? '—'}</div>
        <div className="tabular">Matches: {p.matches} · W {p.wins}</div>
        <div>Titles: {p.championships} · Runner-ups: {p.runnerUps}</div>
        <div>YM: {p.ym ?? '—'} · Email: {p.email ? 'yes' : '—'}</div>
        <div>Existing merges: {p.existingMerges} · splits: {p.existingSplits}</div>
        {p.source && <div>Source: {p.source.file}:{p.source.row}</div>}
      </dl>
    </div>
  )
}

export function IssueDetail({ enriched }: { enriched: any }) {
  const box = 'mt-3 rounded-md bg-muted/40 p-3 text-sm'
  if (!enriched || enriched.missing) return <div className={box}>Raw record not found in staging.</div>

  if (enriched.kind === 'identity') {
    return (
      <div className="mt-3">
        <div className="mb-2 text-xs text-muted-foreground">value: {enriched.value}</div>
        {enriched.signals?.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {enriched.signals.map((s: string) => (
              <Badge key={s} variant={s === 'name_similarity_only' ? 'muted' : 'gold'}>
                {SIGNAL_LABEL[s] ?? s}
              </Badge>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {enriched.players?.map((p: any) => <PlayerCompareCard key={p.canonicalId} p={p} />)}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Signals are evidence, not conclusions. Identities are never merged automatically.</p>
      </div>
    )
  }

  if (enriched.kind === 'match') {
    return (
      <div className={box}>
        <div className="text-xs text-muted-foreground">
          {enriched.competition} · {enriched.division} · {enriched.round ?? enriched.stage}
        </div>
        <div className="mt-1">
          <span className="font-medium">{enriched.competitorA ?? '—'}</span> <span className="text-muted-foreground">vs</span>{' '}
          <span className="font-medium">{enriched.competitorB ?? '—'}</span>
        </div>
        <div className="mt-1 tabular text-muted-foreground">
          score: {enriched.scoreA ?? '—'}–{enriched.scoreB ?? '—'} · recorded winner: {enriched.recordedWinnerRaw ?? '—'} ·
          score-implied winner: {enriched.scoreImpliedWinnerRaw ?? '—'} · resolution: {enriched.resolution}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">raw: {JSON.stringify(enriched.raw)} · source: {enriched.source?.file}:{enriched.source?.row}</div>
        {enriched.diagnostics?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {enriched.diagnostics.map((d: string) => (
              <Badge key={d} variant="muted">{DIAG_LABEL[d] ?? d}</Badge>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Diagnostics are suggestions only — scores/winners are never changed without an approved, evidence-backed decision.</p>
      </div>
    )
  }

  if (enriched.kind === 'championship') {
    return (
      <div className={box}>
        <div>
          {enriched.competition} · {enriched.division} — champion: <span className="font-medium">{enriched.champion}</span>
        </div>
        <div className="mt-1 text-muted-foreground">
          confidence: {enriched.confidence} ({enriched.confidenceRaw}) · playoff records: {String(enriched.playoffRecordsSurvive)} ·
          deciding match survives: {String(enriched.decidingMatchSurvives)}
        </div>
        <div className="mt-1 text-muted-foreground">
          supporting achievement: {String(enriched.supportingAchievements)} · conflicting candidates:{' '}
          {enriched.conflictingCandidates?.length ? enriched.conflictingCandidates.join(', ') : 'none'} · counts in preview:{' '}
          {String(enriched.countsInPreview)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">source: {enriched.source?.file}:{enriched.source?.row}</div>
      </div>
    )
  }

  if (enriched.kind === 'note') {
    const n = enriched.note
    return (
      <div className={box}>
        <div className="font-medium">{n.title}</div>
        {n.claim && <div className="mt-1 text-muted-foreground">claim: {n.claim}</div>}
        <div className="mt-1 text-xs text-muted-foreground">
          source-verified: {String(n.evidence?.sourceVerified)} · user-testimony: {String(n.evidence?.userTestimony)} · status: {n.status}
        </div>
      </div>
    )
  }

  if (enriched.kind === 'entry-method') {
    return <div className={box}>Default entry method for archive competition entries. Do not infer modern registration behavior.</div>
  }
  return null
}
/* eslint-enable @typescript-eslint/no-explicit-any */
