import Link from 'next/link'

import { identityLines, identityText } from '@/lib/identity/display'
import { cn } from '@/lib/utils'
import type { StageGroup, StageStandingRow, StageMatch } from '@/lib/seasons/views'

/**
 * The public group table: a head-to-head matrix with the standings frozen on the right.
 *
 * Two things drive the layout and are worth stating plainly, because both were bugs waiting to
 * happen:
 *
 *  - Every score cell is the SAME fixed size. A cell that sizes to its content makes the grid
 *    ragged, and one long CueVerse ID in a column head would otherwise stretch that whole column.
 *    Widths are set on <col>, so no name can push a column around.
 *  - Column heads therefore show the CueVerse ID alone, truncated with an ellipsis, with the full
 *    identity available on hover, focus and tap. The row heads carry the readable form: preferred
 *    name in bold with the ID beneath it, or just the ID when there is no preferred name — never
 *    the same string printed twice.
 *
 * Ordering is always by points under the official tie-break rules. There is no alternative order.
 */
export function SeasonStandingsMatrix({
  group,
  groupStageGames,
  qualified,
}: {
  group: StageGroup
  groupStageGames: number
  /** Entrant ids that appear in the Season's playoff bracket — the ONLY source of the gold edge. */
  qualified: Set<number>
}) {
  const rows = orderByPoints(group.standings)
  const h2h = headToHead(group.matches)
  const advancing = rows.filter((r) => qualified.has(r.entrantId)).length

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-border bg-card/60 px-4 py-3">
        <h3 className="font-display text-[0.95rem] font-bold text-foreground">
          {group.name || <>Group <span className="text-[var(--gold)]">{group.code}</span></>}
        </h3>
        <Chip>Players <b className="text-foreground">{rows.length}</b></Chip>
        {advancing > 0 && <Chip gold>In the playoffs <b>{advancing}</b></Chip>}
        <Chip>Games per match <b className="text-foreground">{groupStageGames}</b></Chip>
      </header>

      {/* Horizontal scrolling is the deliberate fallback when the matrix genuinely cannot fit —
          shrinking the cells instead would break the fixed-size rule that keeps the grid readable. */}
      <div className="season-scroll overflow-x-auto">
        <table className="season-matrix border-separate border-spacing-0">
          <colgroup>
            <col className="season-col-who" />
            {rows.map((r) => <col key={r.entrantId} className="season-col-cell" />)}
            <col className="season-col-stat" />
            <col className="season-col-wld" />
            <col className="season-col-stat" />
            <col className="season-col-stat" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="season-corner">Pos&nbsp;&nbsp;Player</th>
              {rows.map((c) => {
                const full = identityText({ cueverseId: c.cueverseId ?? c.username, preferredName: c.preferredName })
                return (
                  <th key={c.entrantId} scope="col" className="season-head" title={full}>
                    {/* A link is focusable in its own right, so the full identity stays reachable by
                        keyboard as well as hover. Entrants with no profile fall back to a plain
                        span rather than a link that goes nowhere. */}
                    <PlayerCell slug={c.slug} label={full} className="season-head-id">
                      {identityLines({ cueverseId: c.cueverseId ?? c.username, preferredName: c.preferredName }).primary}
                    </PlayerCell>
                  </th>
                )
              })}
              <th scope="col" className="season-stat-head" title="Win 2, Draw 1, plus 1 for completing every set">Pts</th>
              <th scope="col" className="season-stat-head">W–L–D</th>
              <th scope="col" className="season-stat-head" title="Games won and lost">Games</th>
              <th scope="col" className="season-stat-head" title="Games won as a share of games played">Game%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const lines = identityLines({ cueverseId: r.cueverseId ?? r.username, preferredName: r.preferredName })
              const adv = qualified.has(r.entrantId)
              return (
                <tr key={r.entrantId} data-entrant={r.entrantId} className={cn(adv && 'season-adv')}>
                  <th scope="row" className="season-who">
                    <span className="season-who-in">
                      <span className="season-rank">{i + 1}.</span>
                      <PlayerCell
                        slug={r.slug}
                        label={identityText({ cueverseId: r.cueverseId ?? r.username, preferredName: r.preferredName })}
                        className="min-w-0"
                      >
                        {/* Preferred name leads here and the ID sits beneath it; with no preferred
                            name the ID becomes the single bold label rather than being repeated. */}
                        <span className={cn('block truncate font-semibold', r.kickedOut && 'text-muted-foreground line-through')}>
                          {lines.secondary ?? lines.primary}
                        </span>
                        {lines.secondary && <span className="season-id block truncate">{lines.primary}</span>}
                      </PlayerCell>
                    </span>
                  </th>

                  {rows.map((c, j) => {
                    if (i === j) return <td key={c.entrantId} className="season-diag" aria-hidden />
                    const k = h2h.get(`${r.entrantId}|${c.entrantId}`)
                    if (!k) return <td key={c.entrantId} className="season-cell season-none" title="No match recorded">·</td>
                    if (k.mine == null || k.theirs == null) {
                      return <td key={c.entrantId} className="season-cell season-none" title="Played, score not recorded">–</td>
                    }
                    const tone = k.mine > k.theirs ? 'w' : k.mine < k.theirs ? 'l' : 'd'
                    return (
                      <td key={c.entrantId} className={cn('season-cell season-score', `season-${tone}`)}>
                        {k.mine}–{k.theirs}
                      </td>
                    )
                  })}

                  <td className="season-pts">{r.points}</td>
                  <td className="season-stat">{r.wins}–{r.losses}–{r.draws}</td>
                  <td className="season-stat">{r.gamesWon || r.gamesLost ? `${r.gamesWon}–${r.gamesLost}` : '–'}</td>
                  <td className="season-stat">{gamePct(r)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border px-4 py-2.5 text-[0.7rem] text-muted-foreground">
        <span>Ordered by points — Win 2, Draw 1, plus 1 for completing every set.</span>
        <span><i className="not-italic text-[var(--gold)]">▮</i> gold edge = reached the playoffs</span>
        <span><i className="not-italic text-[var(--gold)]">·</i> no match recorded</span>
        <span><i className="not-italic text-[var(--gold)]">–</i> played, score not recorded</span>
      </footer>
    </section>
  )
}

/**
 * A name in the matrix, linked to the player's profile when there is one to link to.
 *
 * Entrants added without an account have no CueVerse ID and therefore no profile page, so they
 * render as plain text — a link that 404s is worse than no link.
 */
function PlayerCell({
  slug, label, className, children,
}: {
  slug: string | null
  label: string
  className?: string
  children: React.ReactNode
}) {
  if (!slug) return <span className={className} aria-label={label}>{children}</span>
  return (
    <Link
      href={`/players/${encodeURIComponent(slug)}`}
      aria-label={label}
      className={cn('season-link', className)}
    >
      {children}
    </Link>
  )
}

function Chip({ children, gold = false }: { children: React.ReactNode; gold?: boolean }) {
  return (
    <span className={cn(
      'whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[0.7rem]',
      gold ? 'border-[var(--gold-dim)] text-[var(--gold-soft)]' : 'border-border text-muted-foreground',
    )}>
      {children}
    </span>
  )
}

/**
 * Points, then the official tie-breaks: head-to-head, then game win percentage, then name.
 *
 * `rank` already carries the engine's applied tie-breaks (head-to-head included, which can only be
 * resolved inside a group), so it settles anything points cannot. Name is the final deterministic
 * fallback so two identical records never render in a different order between requests.
 */
function orderByPoints(rows: StageStandingRow[]): StageStandingRow[] {
  return [...rows].sort((a, b) =>
    b.points - a.points ||
    a.rank - b.rank ||
    pctOf(b) - pctOf(a) ||
    (a.cueverseId ?? a.username).toLowerCase().localeCompare((b.cueverseId ?? b.username).toLowerCase()))
}

const pctOf = (r: StageStandingRow) => (r.gamesWon + r.gamesLost === 0 ? 0 : r.gamesWon / (r.gamesWon + r.gamesLost))
const gamePct = (r: StageStandingRow) => (r.gamesWon + r.gamesLost === 0 ? '–' : `${Math.round(pctOf(r) * 100)}%`)

/** Every recorded meeting, keyed both ways round so each row reads from its own point of view. */
function headToHead(matches: StageMatch[]): Map<string, { mine: number | null; theirs: number | null }> {
  const out = new Map<string, { mine: number | null; theirs: number | null }>()
  for (const m of matches) {
    if (m.homeEntrantId == null || m.awayEntrantId == null) continue
    out.set(`${m.homeEntrantId}|${m.awayEntrantId}`, { mine: m.homeGames, theirs: m.awayGames })
    out.set(`${m.awayEntrantId}|${m.homeEntrantId}`, { mine: m.awayGames, theirs: m.homeGames })
  }
  return out
}
