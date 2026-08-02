import Link from 'next/link'

import { Panel, PlayerAvatar } from '@/components/home/primitives'
import type { PublicRegistrant } from '@/lib/competition/public'

/**
 * Live Season 2 entrant list — driven entirely by the database. Shows ACTIVE entrants
 * only (they appear immediately on registration, no staff approval needed). PUBLIC
 * IDENTITY ONLY: Display Name + CueVerse ID (+ avatar initials). Email, account User
 * ID, Discord, and all private account data are never passed to this component.
 */
export function RegisteredPlayers({ players }: { players: PublicRegistrant[] }) {
  return (
    <Panel title="Registered Players" actionLabel="Register" actionHref="/register" bodyClassName="flex flex-col p-0">
      <div className="flex items-baseline gap-2 border-b border-border px-4 py-2.5">
        <span className="tabular text-xl font-bold leading-none text-gold">{players.length}</span>
        <span className="text-sm text-muted-foreground">{players.length === 1 ? 'player registered' : 'players registered'}</span>
      </div>

      {players.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No entrants yet.</p>
          <Link href="/register" className="mt-1 inline-block text-sm font-medium text-gold hover:text-gold-soft">
            Be the first to register →
          </Link>
        </div>
      ) : (
        <ul className="scrollbar-gold max-h-[22rem] divide-y divide-border/70 overflow-y-auto">
          {players.map((p, i) => (
            <li key={`${p.displayName}-${i}`} className="flex items-center gap-2.5 px-4 py-2">
              <PlayerAvatar name={p.displayName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{p.displayName}</p>
                {p.cueverseId && p.cueverseId !== p.displayName && (
                  <p className="truncate text-[0.7rem] text-muted-foreground">{p.cueverseId}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
