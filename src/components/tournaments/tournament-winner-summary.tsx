import { Trophy } from 'lucide-react'

import { PlayerAvatar } from '@/components/primitives'
import { PublicPlayerIdentity } from '@/components/identity/public-player-identity'

export interface PodiumIdentity {
  name: string
  cueverseId: string | null
  slug: string | null
}

/**
 * Prominent result summary shown above a completed cup's bracket: champion, runner-up, final score,
 * cup name and completion date. Uses the shared public-identity component (with profile links where
 * a slug exists, plain text otherwise). Runner-up and final score are rendered only when actually
 * stored — never fabricated.
 */
export function CupWinnerSummary({
  cupName,
  champion,
  runnerUp,
  finalScore,
  completedAt,
}: {
  cupName: string
  champion: PodiumIdentity
  runnerUp: PodiumIdentity | null
  finalScore: string | null
  completedAt: string | null
}) {
  return (
    <section className="mt-6 rounded-xl border border-brand/25 bg-brand/[0.06] p-5">
      <div className="flex items-center gap-2">
        <Trophy className="size-5 text-brand" aria-hidden />
        <span className="eyebrow text-brand">Final Result</span>
        {completedAt && <span className="ml-auto text-xs text-muted-foreground">Completed {completedAt}</span>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex items-center gap-3">
          <PlayerAvatar name={champion.name} size="md" />
          <div>
            <p className="eyebrow text-[0.55rem] text-brand">Champion</p>
            <PublicPlayerIdentity preferredName={champion.name} cueverseId={champion.cueverseId} slug={champion.slug} className="text-base" />
          </div>
        </div>

        {runnerUp && (
          <div className="flex items-center gap-3">
            <PlayerAvatar name={runnerUp.name} size="sm" />
            <div>
              <p className="eyebrow text-[0.55rem] text-muted-foreground">Runner-up</p>
              <PublicPlayerIdentity preferredName={runnerUp.name} cueverseId={runnerUp.cueverseId} slug={runnerUp.slug} muted />
            </div>
          </div>
        )}

        {finalScore && (
          <div>
            <p className="eyebrow text-[0.55rem] text-muted-foreground">Final</p>
            <p className="tabular text-base font-semibold text-foreground">{finalScore}</p>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">{cupName} · this result is final and read-only.</p>
    </section>
  )
}
