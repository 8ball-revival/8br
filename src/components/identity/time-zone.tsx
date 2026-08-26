import { Clock } from 'lucide-react'

/**
 * TimeZoneLabel — public display of the user's self-entered time zone, shown verbatim
 * (e.g. "MST", "GMT+1", "America/New_York"). Free-form text; never derives location.
 */
export function TimeZoneLabel({ zone, className }: { zone: string | null | undefined; className?: string }) {
  const value = (zone || '').trim()
  if (!value) return null
  return (
    <span className={className} title={value} aria-label={`Time zone: ${value}`}>
      <Clock className="mr-1 inline size-3.5 align-[-2px] text-muted-foreground" aria-hidden />
      {value}
    </span>
  )
}

/**
 * TimeZoneField — a free-text time-zone input used in registration and My Account. Stores
 * whatever the user types (e.g. "MST"); no IANA constraint or dropdown.
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
  return (
    <input
      id={id}
      name={name}
      defaultValue={defaultValue}
      required={required}
      maxLength={60}
      placeholder="e.g. MST"
      autoComplete="off"
      className="w-full rounded-none border border-input bg-background px-3 py-2 text-sm"
    />
  )
}
