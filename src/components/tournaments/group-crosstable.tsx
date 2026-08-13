import Link from 'next/link'
import { MessageCircle } from 'lucide-react'

import type { WorkspaceGroup } from '@/lib/tournaments/live'

/**
 * Head-to-head crosstable for one round-robin group (MyLeague-style): every player is both a row and
 * a column, so each cell shows how the row player did against the column player (row's games first).
 * Right-hand columns summarize Sets (Pts, W–L–D) and Games (Win %). Player names are gold links to
 * their profile; a single Discord icon under each column DMs that player (dead icon if none linked).
 */

const gold = 'text-[color:var(--player-name)] hover:underline'

/** Player name — a gold profile link (or plain gold text when no profile handle is known). `label` is
 *  what's shown; `title` is the full hover text (defaults to label). */
function PlayerName({ label, title, slug, className = '' }: { label: string; title?: string; slug: string | null; className?: string }) {
  const hover = title ?? label
  if (slug) {
    return (
      <Link href={`/players/${encodeURIComponent(slug)}`} title={hover} className={`${gold} ${className}`}>
        {label}
      </Link>
    )
  }
  return <span title={hover} className={`text-[color:var(--player-name)] ${className}`}>{label}</span>
}

/** Top-column label: the preferred name, or the CueVerse ID when there's no preferred name — capped at 8. */
const topLabel = (preferredName: string | null, cueverseId: string) => (preferredName ?? cueverseId).slice(0, 8)

/** One Discord DM affordance. Linked when the player has a Discord on file; otherwise an inert icon. */
function DiscordIcon({ name, discord }: { name: string; discord: string | null }) {
  if (discord) {
    return (
      <a
        href={`https://discord.com/users/${encodeURIComponent(discord)}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`Message ${name} on Discord`}
        className="inline-flex text-muted-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <MessageCircle className="size-3.5" aria-hidden />
        <span className="sr-only">Message {name} on Discord</span>
      </a>
    )
  }
  return (
    <span title={`${name} has no Discord linked`} aria-disabled="true" className="inline-flex cursor-default text-muted-foreground/30">
      <MessageCircle className="size-3.5" aria-hidden />
    </span>
  )
}

export function GroupCrosstable({ group }: { group: WorkspaceGroup }) {
  const players = group.players // seed order — same on rows and columns so the diagonal lines up
  const standing = new Map(group.standings.map((s) => [s.registrationId, s]))

  // result[row:col] = the row player's line in that head-to-head (games first), or absent if unplayed.
  const result = new Map<string, { text: string; rowWon: boolean }>()
  for (const m of group.matches) {
    const key = (a: number, b: number) => `${a}:${b}`
    if (m.homeGames != null && m.awayGames != null) {
      result.set(key(m.homeRegistrationId, m.awayRegistrationId), { text: `${m.homeGames}-${m.awayGames}`, rowWon: m.winnerRegistrationId === m.homeRegistrationId })
      result.set(key(m.awayRegistrationId, m.homeRegistrationId), { text: `${m.awayGames}-${m.homeGames}`, rowWon: m.winnerRegistrationId === m.awayRegistrationId })
    } else if (m.winnerRegistrationId != null) {
      const homeWon = m.winnerRegistrationId === m.homeRegistrationId
      result.set(key(m.homeRegistrationId, m.awayRegistrationId), { text: homeWon ? 'AW' : 'AL', rowWon: homeWon })
      result.set(key(m.awayRegistrationId, m.homeRegistrationId), { text: homeWon ? 'AL' : 'AW', rowWon: !homeWon })
    }
  }

  const winPct = (gamesWon: number, gamesLost: number) => {
    const total = gamesWon + gamesLost
    return total ? Math.round((gamesWon / total) * 100) : 0
  }

  const th = 'border border-border px-2 py-1 text-center align-middle'
  const td = 'border border-border px-2 py-1 text-center align-middle tabular'
  // Uniform width for every column except the CueVerse-ID name column on the left.
  const COL = '4.5rem'

  return (
    <div className="overflow-x-auto">
      <table className="w-max table-fixed border-collapse text-sm">
        <colgroup>
          <col style={{ width: '11rem' }} />
          {players.map((p) => <col key={p.registrationId} style={{ width: COL }} />)}
          <col style={{ width: COL }} />
          <col style={{ width: COL }} />
          <col style={{ width: COL }} />
        </colgroup>
        <thead>
          <tr className="bg-card/50">
            <th rowSpan={2} className={`${th} text-left font-bold text-foreground`}>{group.name}</th>
            {players.map((p) => (
              <th key={p.registrationId} className={`${th} font-medium`}>
                <PlayerName label={topLabel(p.preferredName, p.cueverseId)} title={p.preferredName ?? p.cueverseId} slug={p.slug} className="block truncate" />
              </th>
            ))}
            <th colSpan={2} className={`${th} text-xs uppercase tracking-wide text-muted-foreground`}>Sets</th>
            <th className={`${th} text-xs uppercase tracking-wide text-muted-foreground`}>Games</th>
          </tr>
          <tr className="bg-card/30">
            {players.map((p) => (
              <th key={p.registrationId} className={`${th}`}>
                <DiscordIcon name={p.cueverseId} discord={p.discord} />
              </th>
            ))}
            <th className={`${th} text-[0.65rem] uppercase text-muted-foreground`}>Pts</th>
            <th className={`${th} text-[0.65rem] uppercase text-muted-foreground`}>W-L-D</th>
            <th className={`${th} text-[0.65rem] uppercase text-muted-foreground`}>Win %</th>
          </tr>
        </thead>
        <tbody>
          {players.map((row) => {
            const s = standing.get(row.registrationId)
            const draws = s ? Math.max(0, s.played - s.wins - s.losses) : 0
            return (
              <tr key={row.registrationId}>
                <th scope="row" className={`${th} text-left font-medium`}>
                  <PlayerName label={row.cueverseId} slug={row.slug} className="block max-w-full truncate" />
                </th>
                {players.map((col) => {
                  if (col.registrationId === row.registrationId) {
                    return <td key={col.registrationId} className={`${td} bg-muted/40`} aria-hidden />
                  }
                  const r = result.get(`${row.registrationId}:${col.registrationId}`)
                  return (
                    <td key={col.registrationId} className={`${td} ${r ? (r.rowWon ? 'font-medium text-foreground' : 'text-muted-foreground') : 'text-muted-foreground/30'}`}>
                      {r ? r.text : ''}
                    </td>
                  )
                })}
                <td className={`${td} font-semibold text-foreground`}>{s?.points ?? 0}</td>
                <td className={`${td} text-muted-foreground`}>{s ? `${s.wins}-${s.losses}-${draws}` : '0-0-0'}</td>
                <td className={`${td} text-muted-foreground`}>{s ? `${winPct(s.gamesWon, s.gamesLost)}` : '0'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
