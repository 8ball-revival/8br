'use client'

import { useMemo } from 'react'
import { Clock } from 'lucide-react'

/** IANA zones the runtime knows about (for the searchable field datalist). */
function allZones(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (Intl as any).supportedValuesOf
    if (typeof fn === 'function') return fn('timeZone') as string[]
  } catch {
    /* fall through */
  }
  return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney', 'UTC']
}

/** A short zone abbreviation (e.g. "EST", "GMT+1") for the given IANA zone, if resolvable. */
function abbrev(zone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(0))
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? null
  } catch {
    return null
  }
}

/**
 * TimeZoneLabel — public display of a saved IANA zone as a readable abbreviation, with the
 * full zone in the accessible label/tooltip. Never derives the user's physical location.
 */
export function TimeZoneLabel({ zone, className }: { zone: string | null | undefined; className?: string }) {
  const value = (zone || '').trim()
  const short = useMemo(() => (value ? abbrev(value) : null), [value])
  if (!value) return null
  return (
    <span className={className} title={value} aria-label={`Time zone: ${value}`}>
      <Clock className="mr-1 inline size-3.5 align-[-2px] text-muted-foreground" aria-hidden />
      {short ?? value}
    </span>
  )
}

/**
 * TimeZoneField — a searchable time-zone input (native input + full IANA datalist), used in
 * registration and My Account. Stores a canonical IANA zone string.
 */
export function TimeZoneField({
  name = 'timeZone',
  defaultValue = '',
  required = true,
  id = 'timeZone',
}: {
  name?: string
  defaultValue?: string
  required?: boolean
  id?: string
}) {
  const zones = useMemo(() => allZones(), [])
  return (
    <>
      <input
        id={id}
        name={name}
        defaultValue={defaultValue}
        required={required}
        list="iana-timezones"
        placeholder="America/New_York"
        autoComplete="off"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <datalist id="iana-timezones">
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  )
}
