import { Trophy, Users } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { PlayerAvatar } from '@/components/home/primitives'
import { DiscordContactButton } from '@/components/identity/discord-contact-button'
import { TimeZoneLabel } from '@/components/identity/time-zone'
import { formatIdentityLabel } from '@/lib/identity/public-identity'
import type { LivePublicProfile } from '@/lib/players/public-profile'

interface Ranking {
  currentRank: number | null
  score: number | null
  peakRating: number | null
}
interface Career {
  seasonTitles: number
  cupTitles: number
  totalWins: number
  totalLosses: number
  totalWinPct: number
}

/**
 * Public LIVE player profile. Heading is `Preferred Name (CueVerse ID)`. Shows Time Zone,
 * a Discord contact icon (never the raw username as text), public aliases, current ranking
 * and titles where available, and competition history. NEVER shows email.
 */
export function LivePlayerProfile({ profile, ranking, career }: { profile: LivePublicProfile; ranking: Ranking | null; career: Career | null }) {
  return (
    <Container className="py-10">
      <div className="flex items-center gap-4">
        <PlayerAvatar name={profile.preferredName} size="xl" />
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {formatIdentityLabel(profile.preferredName, profile.cueverseId)}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {profile.timeZone && <TimeZoneLabel zone={profile.timeZone} />}
            {profile.discord && <DiscordContactButton discord={profile.discord} name={profile.preferredName} />}
          </div>
        </div>
      </div>

      {(ranking || career) && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ranking?.currentRank != null && <Stat label="Current rank" value={`#${ranking.currentRank}`} accent />}
          {ranking?.peakRating != null && <Stat label="Peak rating" value={String(ranking.peakRating)} />}
          {career && <Stat label="Season titles" value={String(career.seasonTitles)} accent={career.seasonTitles > 0} />}
          {career && <Stat label="Cup titles" value={String(career.cupTitles)} accent={career.cupTitles > 0} />}
          {career && <Stat label="Career W–L" value={`${career.totalWins}–${career.totalLosses}`} sub={`${career.totalWinPct}%`} />}
        </div>
      )}

      {profile.competitions.length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow mb-3 flex items-center gap-2 text-foreground"><Trophy className="size-4 text-gold" aria-hidden /> Competition history</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {profile.competitions.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="font-medium">{c.season}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="muted">{c.kind === 'CUP' ? 'Cup' : 'Season'}</Badge>
                  <Badge variant={c.status === 'WITHDRAWN' || c.status === 'REJECTED' ? 'muted' : 'success'}>{c.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.aliases.length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow mb-3 flex items-center gap-2 text-foreground"><Users className="size-4 text-muted-foreground" aria-hidden /> Aliases</h2>
          <div className="flex flex-wrap gap-1.5">
            {profile.aliases.map((a) => <Badge key={a} variant="outline">{a}</Badge>)}
          </div>
        </section>
      )}
    </Container>
  )
}

function Stat({ label, value, accent, sub }: { label: string; value: string; accent?: boolean; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className={`tabular text-xl font-bold ${accent ? 'text-gold' : 'text-foreground'}`}>{value}</div>
      <div className="mt-0.5 text-[0.7rem] tracking-wide text-muted-foreground uppercase">{label}</div>
      {sub && <div className="text-[0.65rem] text-muted-foreground/70">{sub}</div>}
    </div>
  )
}
