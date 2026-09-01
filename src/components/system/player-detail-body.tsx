import 'server-only'

/**
 * Player profile — the real page body, placed by the site builder as a system module.
 *
 * The route (`/players/[cueverse]`) stays a shell that keeps `generateMetadata`, which Next only
 * reads from a route file. Everything the page renders is here, so an administrator can put content
 * above and below the profile and restyle its frame without touching what it says.
 *
 * ── What loads when ─────────────────────────────────────────────────────────────────────────────
 * The 8 Ball Registry record comes from our own database and is awaited: it is the page. CueVerse is
 * a third party, so its card and window stream in their own Suspense boundaries — a slow or down
 * CueVerse delays two panels, not somebody's career.
 */

import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { getPlayerProfilePage } from '@/lib/players/profile'
import { getCueverseProfile } from '@/lib/cueverse/profile'
import { cueverseProfileUrl } from '@/lib/cueverse/links'
import { canEditProfileAction } from '@/lib/players/profile-actions'
import { PlayerProfileView } from '@/components/players/profile/profile-view'
import { CueverseWindow } from '@/components/players/profile/cueverse-window'
import { SITE_URL } from '@/lib/site'

type Params = Promise<{ cueverse: string }>

export async function PlayerDetailBody({
  params,
}: {
  params: Params
  searchParams?: Promise<{ platform?: string }>
}) {
  const { cueverse } = await params
  const param = decodeURIComponent(cueverse)

  /*
    Both careers, together.

    The old page split the profile into a CueVerse tab and a Yahoo Archive tab, each holding its own
    rating. That was right when the question was "what is this player's rating", because a rating
    from two platforms is a rating from neither. It is wrong for a career page: somebody's record is
    their record, and the platform is a property of each Season rather than a separate life. So the
    ledger is read whole, and every Season and Tournament says which platform it was played on.
  */
  const data = await getPlayerProfilePage(param)
  if (!data) notFound()

  // A merged secondary has no independent profile — old links land on the identity that absorbed it.
  const { primaryOfMergedPlayer } = await import('@/lib/players/merge')
  const primary = await primaryOfMergedPlayer(data.identity.playerId)
  if (primary) redirect(`/players/${encodeURIComponent(primary.cueverseId ?? primary.playerId)}`)

  // Decided on the server. The action that actually writes re-establishes the same right.
  const canEdit = await canEditProfileAction(data.identity.playerId)

  /*
    The canonical, absolute URL — what Share hands to another device or another person.

    Built from the site's own configured origin rather than from the request, so a link shared from
    a preview deployment or through a proxy still points at the real profile.
  */
  const shareUrl = `${SITE_URL.replace(/\/$/, '')}/players/${encodeURIComponent(data.identity.slug)}`
  const cvId = data.identity.cueverseId

  return (
    <Container className="py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href="/rankings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-brand">
          <ArrowLeft className="size-4" aria-hidden /> Rankings
        </Link>
        {/* The CueVerse mark, opening the player's own CueVerse profile in a new tab. */}
        {cueverseProfileUrl(cvId) && (
          <a
            href={cueverseProfileUrl(cvId) as string}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-brand"
          >
            CueVerse profile
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>

      {data.identity.aliases.length > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          Also known as {data.identity.aliases.join(', ')}
        </p>
      )}

      <PlayerProfileView
        data={data}
        shareUrl={shareUrl}
        canEdit={canEdit}
        cueverseCard={
          <Suspense fallback={<CueversePlaceholder line="Loading CueVerse record…" />}>
            <CueverseCard cueverseId={cvId} />
          </Suspense>
        }
        cueverseWindow={
          <Suspense fallback={<div className="p-4"><CueversePlaceholder line="Loading the latest 100 CueVerse games…" /></div>}>
            <CueverseWindowLoader cueverseId={cvId} />
          </Suspense>
        }
      />
    </Container>
  )
}

/** The Overview card face: CueVerse's headline figures, clearly labelled as theirs. */
async function CueverseCard({ cueverseId }: { cueverseId: string | null }) {
  const result = await getCueverseProfile(cueverseId ?? '')
  if (result.status !== 'ok') {
    return (
      <p className="text-sm text-muted-foreground">
        {result.status === 'no-id' ? 'No CueVerse ID recorded for this player.'
          : result.status === 'not-found' ? 'CueVerse has no profile for this ID.'
            : result.reason}
      </p>
    )
  }
  const r = result.profile.record
  return (
    <div>
      <dl className="grid grid-cols-2 gap-3">
        <Cell label="CueVerse rating" value={String(r.rating)} accent />
        <Cell label="Record" value={`${r.wins}–${r.losses}${r.draws ? `–${r.draws}` : ''}`} />
        <Cell label="Games" value={String(r.total)} />
        <Cell label="Streak" value={result.profile.streakLabel} />
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        CueVerse figures. Separate from the 8 Ball Registry record above.
      </p>
    </div>
  )
}

async function CueverseWindowLoader({ cueverseId }: { cueverseId: string | null }) {
  const result = await getCueverseProfile(cueverseId ?? '')
  return <CueverseWindow result={result} cueverseId={cueverseId} />
}

function CueversePlaceholder({ line }: { line: string }) {
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {line}
    </p>
  )
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[0.62rem] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={`font-display text-lg font-bold ${accent ? 'text-[var(--gold)]' : 'text-foreground'}`}>{value}</dd>
    </div>
  )
}
