'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Search, Trophy, X } from 'lucide-react'

import type { BracketRound } from '@/lib/tournaments/fixtures'
import type { StageGroup } from '@/lib/seasons/views'
import type { HonorRollEntry, YahooSummary } from '@/lib/yahoo/archive'
import { DoubleElimBracket } from '@/components/brackets/double-elim-bracket'
import { cn } from '@/lib/utils'

/**
 * The Yahoo Pool Archive: one page you browse, rather than a directory you keep leaving.
 *
 * ── What it will not do ──────────────────────────────────────────────────────────────────────────
 * Fill a gap. Where the archive has no champion, no runner-up or no final score, this says so in
 * words — "Unknown", "Not available in the surviving archive" — and never prints a dash that could
 * be mistaken for a recorded result or a zero that could be mistaken for a score. Everything shown
 * came out of the database; nothing is derived from a neighbouring season.
 *
 * ── Selection is the URL ─────────────────────────────────────────────────────────────────────────
 * Which season is open, which half of it, and which group, are all query parameters, resolved on the
 * server before this renders. So a link can be shared, Back works, and the explorer never shows one
 * season while the address bar claims another.
 */

export interface YahooLadderRow {
  rank: number
  slug: string
  label: string
  preferredName: string
  cueverseId: string | null
  rating: number
  peakRating: number
  wins: number
  losses: number
  draws: number
  played: number
  matchWinPct: number
  gameWinPct: number
  gameDiff: number
  currentStreak: number
  seasonsPlayed: number
}

export interface YahooSelection {
  entry: HonorRollEntry
  groups: StageGroup[]
  rounds: BracketRound[]
  /** Entrant id -> profile href, resolved on the server. Absent means no identity was ever tied. */
  links: Record<number, string>
}

const UNKNOWN = 'Unknown'

/**
 * How much of the legacy ladder is shown before it is asked for.
 *
 * All 498 players rendered at once make the page eighteen thousand pixels tall. The honour roll
 * beside it ends after four thousand, so three quarters of the layout is one column of names against
 * an empty column -- and the explorer, which opens under both, ends up a scroll nobody would make.
 * The whole ladder is still one click away and still has no inner scrollbar; searching looks through
 * every player regardless of what is currently drawn.
 */
const LADDER_PREVIEW = 100
const NOT_IN_ARCHIVE = 'Not available in the surviving archive'

/** Respect the reader's motion preference for both the scroll and the expansion. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return reduced
}

export function YahooArchive({
  summary, honorRoll, ladder, selected, view, group,
}: {
  summary: YahooSummary
  honorRoll: HonorRollEntry[]
  ladder: YahooLadderRow[]
  selected: YahooSelection | null
  view: 'groups' | 'playoffs'
  group: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const reduced = usePrefersReducedMotion()
  const explorerRef = useRef<HTMLElement>(null)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  /** Rewrite the URL, keeping every parameter this page does not own. */
  const urlWith = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k)
      else next.set(k, v)
    }
    const qs = next.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }, [params, pathname])

  const go = useCallback((patch: Record<string, string | null>) => {
    router.push(urlWith(patch), { scroll: false })
  }, [router, urlWith])

  /*
   * Move to the explorer once it is on screen, and put the keyboard there with it.
   *
   * Guarded on the season id so this fires when the SELECTION changes rather than on every
   * re-render -- switching from groups to playoffs should not yank the page around.
   *
   * Two frames, not zero. The browser restores its own scroll position when a navigation settles,
   * and a scroll issued in the same frame is simply undone by it: the explorer took focus and the
   * page stayed at the top, which is the worst of both. Waiting for the frame after paint puts this
   * last.
   *
   * A deep link JUMPS and a click GLIDES. Sliding seventeen thousand pixels because somebody pasted
   * a URL is not an animation, it is a wait; but when the reader clicked a season card the movement
   * is what tells them where the answer went. Reduced motion turns both into a jump.
   */
  const openedId = selected?.entry.id ?? null
  useEffect(() => {
    if (openedId == null) return

    /*
     * Move to the explorer, and keep trying until it is actually there.
     *
     * Two things scroll this page back to the top on arrival -- the browser restoring its own
     * position on a reload, and the router settling a fresh navigation -- and both land AFTER a
     * single effect would have run. Rather than guessing how many frames to wait, this checks
     * whether the explorer is in view and tries again if it is not, giving up after about three
     * quarters of a second instead of fighting a reader who has started scrolling themselves.
     *
     * Distance chooses the behaviour, not a flag. Below two screens the glide is what tells the
     * reader where the season opened; the archive ladder is five hundred players long, so from the
     * top of the page the same animation is a fifteen-thousand-pixel wait that says nothing. It also
     * has to be a jump for the retry to mean anything: re-issuing a smooth scroll every sixtieth of
     * a second restarts it forever, so only a jump is retried.
     */
    /*
     * Restoration off while this runs.
     *
     * On a reload the browser puts the page back where it was -- the top -- and it does that after
     * the effect, so every scroll issued here was being undone a moment later and the deep link
     * appeared to do nothing at all. Turning restoration off says who is deciding the position; it is
     * put back on the way out so ordinary pages keep the behaviour a reader expects.
     */
    const restoration = typeof history !== 'undefined' ? history.scrollRestoration : undefined
    if (restoration !== undefined) history.scrollRestoration = 'manual'

    /*
     * Stop the moment the reader takes over. Everything below is an attempt to put the page where
     * they asked for it; the one thing it must never do is drag them back from somewhere they chose
     * to go.
     */
    let taken = false
    const yield_ = () => { taken = true }
    for (const ev of ['wheel', 'touchstart', 'keydown'] as const) {
      window.addEventListener(ev, yield_, { passive: true, once: true })
    }

    let timer = 0
    let tries = 0
    const settle = () => {
      const el = explorerRef.current
      if (!el || taken) return
      const top = el.getBoundingClientRect().top
      if (Math.abs(top) > 120 && tries < 50) {
        tries++
        const jump = reduced || Math.abs(top) > window.innerHeight * 2
        /*
         * `instant`, not `auto`.
         *
         * `auto` does not mean "no animation" -- it means "whatever CSS says", and this site sets
         * `scroll-behavior: smooth` on the root. So every jump here was quietly an animation, and the
         * retry below restarted it every sixtieth of a second: the page crept a couple of hundred
         * pixels, the loop ran out, and a deep link looked as though it had scrolled nowhere.
         */
        el.scrollIntoView({ behavior: jump ? 'instant' : 'smooth', block: 'start' })
        if (jump) { timer = window.setTimeout(settle, 100); return }
      }
      el.focus({ preventScroll: true })
    }
    timer = window.setTimeout(settle, 0)
    return () => {
      window.clearTimeout(timer)
      for (const ev of ['wheel', 'touchstart', 'keydown'] as const) {
        window.removeEventListener(ev, yield_)
      }
      if (restoration !== undefined) history.scrollRestoration = restoration
    }
  }, [openedId, reduced])

  const close = useCallback(() => {
    const id = openedId
    router.push(urlWith({ season: null, view: null, group: null }), { scroll: false })
    // Focus returns to the card that opened it, so keyboard position is not lost.
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-season-card="${id}"]`)?.focus()
    })
  }, [openedId, router, urlWith])

  useEffect(() => {
    if (openedId == null) return
    const onKey = (e: KeyboardEvent) => {
      // Only when the press did not belong to something else, e.g. a search field being cleared.
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openedId, close])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ladder
    // Search always looks through the WHOLE ladder, not the part currently drawn -- otherwise a
    // player ranked 300th would appear not to exist.
    return ladder.filter((r) =>
      r.label.toLowerCase().includes(q)
      || r.preferredName.toLowerCase().includes(q)
      || (r.cueverseId ?? '').toLowerCase().includes(q))
  }, [ladder, query])

  const searching = query.trim().length > 0
  const capped = !searching && !showAll && filtered.length > LADDER_PREVIEW
  const shown = capped ? filtered.slice(0, LADDER_PREVIEW) : filtered

  const order = honorRoll.map((h) => h.id)
  const at = openedId != null ? order.indexOf(openedId) : -1
  const prev = at > 0 ? honorRoll[at - 1] : null
  const next = at >= 0 && at < honorRoll.length - 1 ? honorRoll[at + 1] : null

  return (
    <div className="ya-root w-full">
      <header className="mb-5">
        <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.22em] text-[var(--cyan)]">Historical Archive</p>
        <h1 className="font-display text-3xl font-black tracking-tight text-foreground sm:text-4xl">Yahoo Pool Archive</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          The original Yahoo era of 8BRCAM, kept as it survived. Ratings here are a separate legacy
          ladder — they are not part of the current CueVerse rankings.
        </p>
      </header>

      <Summary s={summary} />

      {/* Desktop puts the ladder beside the honour roll; a phone reads the honour roll first. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section aria-labelledby="ya-ladder" className="order-2 min-w-0 lg:order-1">
          <SectionHead
            id="ya-ladder"
            title="Yahoo Legacy Rankings"
            note={capped ? `top ${LADDER_PREVIEW} of ${ladder.length}` : `${ladder.length} players`}
          />
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the legacy ladder…"
                aria-label="Search the Yahoo legacy rankings"
                className="w-full rounded-none border border-border bg-background py-1.5 pl-8 pr-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </div>
          </div>
          <LadderTable rows={shown} />
          {capped && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-2 w-full border border-border bg-card px-3 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--cyan)] transition-colors hover:bg-[var(--graphite-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              Show all {ladder.length} players
            </button>
          )}
          {!capped && !searching && ladder.length > LADDER_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="mt-2 w-full border border-border bg-card px-3 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              Show the top {LADDER_PREVIEW} only
            </button>
          )}
          {searching && (
            <p className="mt-2 text-[0.7rem] text-muted-foreground">
              {filtered.length} of {ladder.length} players match.
            </p>
          )}
        </section>

        <section aria-labelledby="ya-honor" className="order-1 min-w-0 lg:order-2">
          <SectionHead id="ya-honor" title="Season Honor Roll" note={`${honorRoll.length} seasons`} />
          <ol className="ya-roll space-y-2">
            {honorRoll.map((h) => (
              <SeasonCard
                key={h.id}
                entry={h}
                selected={h.id === openedId}
                onOpen={() => go({ season: String(h.id), view })}
              />
            ))}
          </ol>
        </section>
      </div>

      {selected && (
        <SeasonExplorer
          ref={explorerRef}
          selection={selected}
          view={view}
          group={group}
          prev={prev}
          next={next}
          onView={(v) => go({ view: v, group: null })}
          onGroup={(g) => go({ group: g })}
          onGo={(id) => go({ season: String(id), view, group: null })}
          onClose={close}
        />
      )}

      <p className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
        A historical community archive. 8 Ball Registry is not affiliated with or endorsed by Yahoo.
      </p>
    </div>
  )
}

function SectionHead({ id, title, note }: { id: string; title: string; note?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-border pb-2">
      <h2 id={id} className="font-display text-sm font-extrabold uppercase tracking-[0.16em] text-[var(--gold)]">{title}</h2>
      {note && <span className="text-[0.7rem] text-muted-foreground">{note}</span>}
    </div>
  )
}

function Summary({ s }: { s: YahooSummary }) {
  const years = s.firstYear != null && s.lastYear != null ? `${s.firstYear}–${s.lastYear}` : UNKNOWN
  const cells: [string, string][] = [
    ['Seasons', String(s.seasons)],
    ['Players', String(s.players)],
    ['Matches', s.matches.toLocaleString()],
    ['Years', years],
    ['Champions', `${s.distinctChampions} of ${s.champions}`],
    ['Tournaments', String(s.tournaments)],
  ]
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
      {cells.map(([k, v]) => (
        <div key={k} className="bg-card px-3 py-2.5">
          <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{k}</dt>
          <dd className="tabular mt-0.5 font-display text-xl font-black text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function LadderTable({ rows }: { rows: YahooLadderRow[] }) {
  if (!rows.length) {
    return <p className="border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">No players match that search.</p>
  }
  return (
    <div className="scrollbar-themed min-w-0 overflow-x-auto border border-border">
      <table className="w-full min-w-[38rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-card text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground">
            <th scope="col" className="px-2 py-2 text-right">#</th>
            <th scope="col" className="px-2 py-2 text-left">Player</th>
            <th scope="col" className="px-2 py-2 text-right">Legacy rating</th>
            <th scope="col" className="px-2 py-2 text-right">W</th>
            <th scope="col" className="px-2 py-2 text-right">L</th>
            <th scope="col" className="px-2 py-2 text-right">T</th>
            <th scope="col" className="px-2 py-2 text-right">Played</th>
            <th scope="col" className="px-2 py-2 text-right">Win %</th>
            <th scope="col" className="px-2 py-2 text-right">Seasons</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slug} className="border-b border-border/60 last:border-0 hover:bg-card">
              <td className="tabular px-2 py-1.5 text-right text-muted-foreground">{r.rank}</td>
              <td className="px-2 py-1.5">
                <Link
                  /*
                    `platform=yahoo` is not decoration: without it the profile opens on the CueVerse
                    career, which for an archive player is empty. A link from the legacy ladder has
                    to land on the legacy record.
                  */
                  href={`/players/${encodeURIComponent(r.slug)}?platform=yahoo`}
                  className="font-medium text-foreground underline-offset-2 hover:text-[var(--gold)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  {r.label}
                </Link>
              </td>
              <td className="tabular px-2 py-1.5 text-right font-semibold text-[var(--gold)]">{Math.round(r.rating)}</td>
              <td className="tabular px-2 py-1.5 text-right">{r.wins}</td>
              <td className="tabular px-2 py-1.5 text-right">{r.losses}</td>
              <td className="tabular px-2 py-1.5 text-right">{r.draws}</td>
              <td className="tabular px-2 py-1.5 text-right">{r.played}</td>
              <td className="tabular px-2 py-1.5 text-right">{r.matchWinPct.toFixed(1)}%</td>
              <td className="tabular px-2 py-1.5 text-right text-muted-foreground">{r.seasonsPlayed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SeasonCard({ entry, selected, onOpen }: { entry: HonorRollEntry; selected: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        data-season-card={entry.id}
        aria-pressed={selected}
        aria-expanded={selected}
        onClick={onOpen}
        className={cn(
          'ya-card w-full border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          /*
            Selection is a NEUTRAL step up in lightness with a gold edge, never a gold wash. Gold at
            10% over charcoal mixes to olive-brown -- the rule the whole palette rests on, written
            down in globals.css beside --selected-surface.
          */
          selected
            ? 'border-[var(--gold)] bg-[var(--selected-surface)]'
            : 'border-border bg-card hover:border-[var(--line-strong)]',
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-sm font-bold text-foreground">{entry.title}</span>
          <span className="tabular text-[0.7rem] text-muted-foreground">{entry.year}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-sm">
          <Trophy className="size-3.5 shrink-0 text-[var(--gold)]" aria-hidden />
          {entry.champion
            ? <span className="font-semibold text-[var(--gold)]">{entry.champion}</span>
            : <span className="italic text-muted-foreground">{UNKNOWN}</span>}
          {entry.finalsForfeit && <span className="text-[0.62rem] uppercase tracking-wider text-destructive">by forfeit</span>}
        </div>
        <div className="mt-0.5 pl-5 text-[0.78rem]">
          {entry.runnerUp
            ? <span className="ya-runner">{entry.runnerUp}</span>
            : <span className="italic text-muted-foreground">Runner-up {UNKNOWN.toLowerCase()}</span>}
          {entry.finalScore && <span className="tabular ml-2 text-muted-foreground">{entry.finalScore}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.66rem] text-muted-foreground">
          <span>{entry.entrants > 0 ? `${entry.entrants} entrants` : 'Entrant count unknown'}</span>
          {entry.format && <span>{entry.format}</span>}
          <span className={cn('ml-auto font-semibold', selected ? 'text-[var(--gold)]' : 'text-[var(--cyan)]')}>
            {selected ? 'Open below' : 'View season →'}
          </span>
        </div>
      </button>
    </li>
  )
}

const SeasonExplorer = function SeasonExplorer({
  ref, selection, view, group, prev, next, onView, onGroup, onGo, onClose,
}: {
  ref: React.Ref<HTMLElement>
  selection: YahooSelection
  view: 'groups' | 'playoffs'
  group: string | null
  prev: HonorRollEntry | null
  next: HonorRollEntry | null
  onView: (v: 'groups' | 'playoffs') => void
  onGroup: (g: string) => void
  onGo: (id: number) => void
  onClose: () => void
}) {
  const { entry, groups, rounds, links } = selection
  const active = groups.find((g) => g.code.toLowerCase() === (group ?? '').toLowerCase()) ?? groups[0] ?? null

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label={`${entry.title} — ${entry.year}`}
      className="ya-explorer mt-8 scroll-mt-24 border border-[var(--gold)]/40 bg-card focus-visible:outline-none"
    >
      <header className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.18em] text-[var(--cyan)]">Season Explorer</p>
          <h2 className="font-display text-xl font-black text-foreground">{entry.title} · {entry.year}</h2>
          <p className="mt-1 text-sm">
            <Trophy className="mr-1 inline size-3.5 text-[var(--gold)]" aria-hidden />
            {entry.champion ? <span className="font-semibold text-[var(--gold)]">{entry.champion}</span> : <span className="italic text-muted-foreground">{UNKNOWN}</span>}
            {entry.runnerUp && <span className="ya-runner"> def. {entry.runnerUp}</span>}
            {entry.finalScore
              ? <span className="tabular ml-2 text-muted-foreground">{entry.finalScore}</span>
              : <span className="ml-2 italic text-muted-foreground">Final score {UNKNOWN.toLowerCase()}</span>}
          </p>
          <p className="mt-1 text-[0.7rem] text-muted-foreground">
            {entry.entrants > 0 ? `${entry.entrants} entrants` : 'Entrant count unknown'}
            {entry.format ? ` · ${entry.format}` : ''}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => prev && onGo(prev.id)} disabled={!prev}
            className="inline-flex items-center gap-1 border border-border px-2 py-1 text-[0.7rem] text-muted-foreground disabled:opacity-35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
            <ChevronLeft className="size-3.5" aria-hidden /> Prev
          </button>
          <button type="button" onClick={() => next && onGo(next.id)} disabled={!next}
            className="inline-flex items-center gap-1 border border-border px-2 py-1 text-[0.7rem] text-muted-foreground disabled:opacity-35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
            Next <ChevronRight className="size-3.5" aria-hidden />
          </button>
          <button type="button" onClick={onClose} aria-label="Close the season explorer"
            className="grid size-7 place-items-center border border-border text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </header>

      <div role="tablist" aria-label="Season view" className="flex gap-px border-b border-border bg-border">
        {(['groups', 'playoffs'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            aria-controls={`ya-panel-${v}`}
            id={`ya-tab-${v}`}
            tabIndex={view === v ? 0 : -1}
            onClick={() => onView(v)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault()
                onView(v === 'groups' ? 'playoffs' : 'groups')
              }
            }}
            className={cn(
              'flex-1 px-3 py-2 text-[0.72rem] font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
              view === v ? 'bg-brand text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {v === 'groups' ? 'Groups' : 'Playoffs'}
          </button>
        ))}
      </div>

      <div id={`ya-panel-${view}`} role="tabpanel" aria-labelledby={`ya-tab-${view}`} className="p-4">
        {view === 'groups' ? (
          groups.length === 0
            ? <Missing>Group results are {NOT_IN_ARCHIVE.toLowerCase()} for this season.</Missing>
            : (
              <>
                {groups.length > 1 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        aria-pressed={active?.id === g.id}
                        onClick={() => onGroup(g.code.toLowerCase())}
                        className={cn(
                          'border px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                          active?.id === g.id ? 'border-[var(--gold)] text-[var(--gold)]' : 'border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {g.name || `Group ${g.code}`}
                      </button>
                    ))}
                  </div>
                )}
                {active ? <GroupTable group={active} links={links} /> : <Missing>No group selected.</Missing>}
              </>
            )
        ) : (
          rounds.length === 0
            ? <Missing>The playoff bracket is {NOT_IN_ARCHIVE.toLowerCase()} for this season.</Missing>
            : <DoubleElimBracket rounds={rounds} champion={entry.champion} />
        )}
      </div>
    </section>
  )
}

function Missing({ children }: { children: React.ReactNode }) {
  return (
    <p className="border border-dashed border-border px-3 py-8 text-center text-sm italic text-muted-foreground">
      {children}
    </p>
  )
}

function GroupTable({ group, links }: { group: StageGroup; links: Record<number, string> }) {
  return (
    <>
      <StandingsTable group={group} links={links} />
      <GroupMatches group={group} />
    </>
  )
}

/**
 * The group's own results, listed under its table.
 *
 * A standing says a player finished 7-2; only the match list says who the two were. Rows with no
 * recorded score are shown as unrecorded rather than 0-0, because the archive losing a score is not
 * the same event as a match ending nil-nil.
 */
function GroupMatches({ group }: { group: StageGroup }) {
  if (!group.matches.length) {
    return <p className="mt-3 text-xs italic text-muted-foreground">Match history is {NOT_IN_ARCHIVE.toLowerCase()} for this group.</p>
  }
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-[0.62rem] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
        Match history — {group.matches.length} {group.matches.length === 1 ? 'match' : 'matches'}
      </h3>
      <ul className="grid gap-px border border-border bg-border sm:grid-cols-2">
        {group.matches.map((m) => {
          const recorded = m.homeGames != null && m.awayGames != null
          const ff = m.forfeitEntrantId != null
          return (
            <li key={m.id} className="flex items-center gap-2 bg-card px-2.5 py-1.5 text-[0.78rem]">
              <span className={cn('min-w-0 flex-1 truncate', m.winnerEntrantId === m.homeEntrantId && 'font-semibold text-foreground')}>{m.homeUsername}</span>
              {recorded
                ? <span className="tabular shrink-0 px-1 font-semibold">{m.homeGames}<span className="mx-1 text-muted-foreground">–</span>{m.awayGames}</span>
                : <span className="shrink-0 px-1 text-[0.66rem] italic text-muted-foreground">unrecorded</span>}
              <span className={cn('min-w-0 flex-1 truncate text-right', m.winnerEntrantId === m.awayEntrantId && 'font-semibold text-foreground')}>{m.awayUsername}</span>
              {ff && <span className="shrink-0 text-[0.58rem] uppercase tracking-wider text-destructive">ff</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function StandingsTable({ group, links }: { group: StageGroup; links: Record<number, string> }) {
  return (
    <div className="scrollbar-themed min-w-0 overflow-x-auto border border-border">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="sr-only">{group.name || `Group ${group.code}`} final standings</caption>
        <thead>
          <tr className="border-b border-border bg-card text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground">
            <th scope="col" className="px-2 py-2 text-right">#</th>
            <th scope="col" className="px-2 py-2 text-left">Player</th>
            {/*
              Played is shown rather than implied. A roster entry who never played reads 0-0-0, which
              is the same three digits as somebody who played nothing but forfeits; the P column is
              what separates "did not compete" from "competed and lost".
            */}
            <th scope="col" className="px-2 py-2 text-right">P</th>
            <th scope="col" className="px-2 py-2 text-right">W</th>
            <th scope="col" className="px-2 py-2 text-right">L</th>
            <th scope="col" className="px-2 py-2 text-right">T</th>
            <th scope="col" className="px-2 py-2 text-right">Pts</th>
            <th scope="col" className="px-2 py-2 text-right">Diff</th>
          </tr>
        </thead>
        <tbody>
          {group.standings.map((s) => (
            <tr key={s.entrantId} className={cn('border-b border-border/60 last:border-0', s.qualified && 'bg-[var(--selected-surface)]')}>
              <td className="tabular px-2 py-1.5 text-right text-muted-foreground">{s.rank}</td>
              <td className="px-2 py-1.5">
                {links[s.entrantId]
                  ? <Link href={links[s.entrantId]} className="text-foreground underline-offset-2 hover:text-[var(--gold)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">{s.username}</Link>
                  : <span className="text-foreground">{s.username}</span>}
                {s.qualified && <span className="ml-2 text-[0.6rem] font-bold uppercase tracking-wider text-[var(--gold)]">advanced</span>}
                {s.played === 0 && <span className="ml-2 text-[0.6rem] uppercase tracking-wider text-muted-foreground">no matches recorded</span>}
              </td>
              <td className="tabular px-2 py-1.5 text-right text-muted-foreground">{s.played}</td>
              <td className="tabular px-2 py-1.5 text-right">{s.wins}</td>
              <td className="tabular px-2 py-1.5 text-right">{s.losses}</td>
              <td className="tabular px-2 py-1.5 text-right">{s.draws}</td>
              <td className="tabular px-2 py-1.5 text-right font-semibold">{s.points}</td>
              <td className="tabular px-2 py-1.5 text-right text-muted-foreground">{s.gamesWon - s.gamesLost > 0 ? '+' : ''}{s.gamesWon - s.gamesLost}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
