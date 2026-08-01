import { Panel, PlayerAvatar } from '@/components/home/primitives'
import type { Registrant } from '@/lib/home/fixtures'

export function RegisteredPlayers({ players }: { players: Registrant[] }) {
  const timezones = new Set(players.map((p) => p.timezone.trim().toUpperCase())).size
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Panel
      title="Registered Players"
      actionLabel="Register"
      actionHref="/register"
      bodyClassName="flex flex-col p-0"
    >
      <div className="flex items-baseline gap-2 border-b border-border px-4 py-2.5">
        <span className="tabular text-xl font-bold leading-none text-gold">{players.length}</span>
        <span className="text-sm text-muted-foreground">signed up</span>
        <span className="ml-auto text-xs text-muted-foreground">{timezones} time zones</span>
      </div>

      <ul className="scrollbar-gold max-h-[22rem] divide-y divide-border/70 overflow-y-auto">
        {sorted.map((p) => (
          <li key={`${p.name}-${p.discord}`} className="flex items-center gap-2.5 px-4 py-2">
            <PlayerAvatar name={p.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
              <p className="truncate text-[0.7rem] text-muted-foreground">{p.handle}</p>
            </div>
            <span className="tabular shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase text-muted-foreground">
              {p.timezone}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
