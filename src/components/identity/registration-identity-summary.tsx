import Link from 'next/link'

import { formatIdentityLabel } from '@/lib/identity/public-identity'
import { DiscordContactButton } from './discord-contact-button'
import { TimeZoneLabel } from './time-zone'

/**
 * RegistrationIdentitySummary — the shared "Registering as: Preferred Name (CueVerse ID)"
 * confirmation shown on BOTH Cup and Season signup. A signed-in member never re-enters
 * identity; this reads from their linked profile. Discord/time zone are read-only context.
 */
export function RegistrationIdentitySummary({
  preferredName,
  cueverseId,
  discord,
  timeZone,
}: {
  preferredName: string
  cueverseId: string | null
  discord?: string | null
  timeZone?: string | null
}) {
  return (
    <div className="rounded-md border border-border bg-card/50 px-4 py-3">
      <p className="eyebrow text-muted-foreground">Registering as</p>
      <p className="mt-1 text-base font-semibold text-foreground">{formatIdentityLabel(preferredName, cueverseId)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {timeZone && <TimeZoneLabel zone={timeZone} />}
        {discord && <DiscordContactButton discord={discord} name={preferredName} />}
        <Link href="/account" className="font-medium text-gold hover:text-gold-soft">Manage profile</Link>
      </div>
    </div>
  )
}
