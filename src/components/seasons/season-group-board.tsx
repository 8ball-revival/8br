'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Lock } from 'lucide-react'

import { useDecorativeMotion } from '@/components/players/profile/motion'
import { WIN_POINTS, DRAW_POINTS, COMPLETION_BONUS } from '@/lib/competition/standings'
import type { BoardGroup, BoardPlayer, BoardCell } from '@/lib/seasons/group-board'
import { cn } from '@/lib/utils'

/**
 * One group, as a competition board.
 *
 * ── What the redesign actually changed ──────────────────────────────────────────────────────────
 * The data is the same data and the order is the same order. What changed is that every figure now
 * arrives already derived — sets played, completion, remaining, clinch — instead of being counted
 * here, and the presentation stopped being a spreadsheet: an identity strip instead of two lines of
 * text, a zebra that runs the full width of a very wide row, a score hierarchy that says who won at
 * a glance, and a cutoff line drawn from the configured advancement count rather than a row index.
 *
 * ── Two things this deliberately does NOT do ────────────────────────────────────────────────────
 * It does not compute a standing, and it does not make a score interactive. Points, wins, games and
 * rank are read; scores are text. A cell that looked clickable would promise a replay this registry
 * does not have.
 */
export function SeasonGroupBoard({ group }: { group: BoardGroup }) {
  const boardRef = useRef<HTMLElement>(null)
  /*
    The shared gate: no motion under `prefers-reduced-motion`, none while the tab is hidden, none
    while this board is scrolled off screen. A page holding four boards therefore animates only the
    ones actually in view, and none of them in a background tab.
  */
  const animate = useDecorativeMotion(boardRef)

  /** The row a reader has pinned by clicking, so a touch device can keep one lit. */
  const [pinned, setPinned] = useState<number | null>(null)
  /*
    The hovered opponent COLUMN, as one piece of state on the table rather than per cell.

    Written on pointer enter of a cell and read by a CSS attribute selector. One state value for the
    whole board, updated only when the column actually changes — moving along a row does not
    re-render, because the column has not changed.
  */
  const [col, setCol] = useState<number | null>(null)

  const { players } = group

  return (
    <section
      ref={boardRef}
      aria-labelledby={`gb-${group.id}`}
      className="gb-board"
    >
      <span aria-hidden className={cn('gb-glow', animate && 'gb-glow-live')} />
      <span aria-hidden className={cn('gb-frame', animate && 'gb-frame-live')} />

      <header className="gb-head">
        <h3 id={`gb-${group.id}`} className="gb-head-name">
          {group.name || `Group ${group.code}`}
        </h3>
        {/*
          Group-specific facts only.

          The season's own totals moved to the overview above. Repeating them here was the single
          biggest source of the page disagreeing with itself, because each copy counted slightly
          differently.
        */}
        <p className="gb-head-facts">
          <span>{players.length} {players.length === 1 ? 'player' : 'players'}</span>
          <span className="gb-head-sep" aria-hidden>·</span>
          <span>{group.setsPlayed}/{group.setsTotal} sets</span>
          <span className="gb-head-sep" aria-hidden>·</span>
          <span>{group.percent}% complete</span>
          {group.advancing > 0 && (
            <>
              <span className="gb-head-sep" aria-hidden>·</span>
              <span className="gb-head-advance">Top {group.advancing} advance</span>
            </>
          )}
        </p>
        <p className="gb-head-facts ml-auto">
          <Lock className="size-3 text-[var(--gold)]" aria-hidden />
          <span>Clinched</span>
          <span className={group.clinched > 0 ? 'text-[var(--gold)]' : ''}>
            {group.clinched > 0 ? group.clinched : 'None yet'}
          </span>
        </p>
      </header>

      {/*
        Horizontal scrolling is the deliberate fallback for a matrix that genuinely cannot fit.

        Shrinking cells instead would break the fixed-width rule that keeps the grid aligned, and
        the brief is explicit that IDs and scores must not be compressed to the point of being
        unreadable. The bar is themed so it reads as part of the board rather than as the platform's.
      */}
      <div className="gb-scroll">
        <table className="gb-matrix" data-col={col ?? ''}>
          <caption className="sr-only">
            {group.name || `Group ${group.code}`}: head-to-head results and standings.
            Rows are players, columns are their opponents.
          </caption>
          <colgroup>
            <col className="gb-col-who" />
            {players.map((p) => <col key={p.entrantId} className="gb-col-cell" />)}
            <col className="gb-col-pts" />
            <col className="gb-col-wld" />
            <col className="gb-col-stat" />
            <col className="gb-col-stat" />
            <col className="gb-col-rem" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="gb-corner">Pos&nbsp;&nbsp;Player</th>
              {players.map((c) => (
                <th key={c.entrantId} scope="col" title={c.cueverseId}>
                  {/*
                    The CueVerse ID alone — no preferred name, no avatar, no monogram.

                    The header says which column this is. A second line of names doubled its height
                    to repeat what the left column already carries, and avatars in a header turned a
                    row of identities into a row of pictures nobody could scan.
                  */}
                  {c.slug ? (
                    <Link href={`/players/${encodeURIComponent(c.slug)}`} className="gb-head-id">
                      {c.cueverseId}
                    </Link>
                  ) : (
                    <span className="gb-head-id">{c.cueverseId}</span>
                  )}
                </th>
              ))}
              <th scope="col" title={`Win ${WIN_POINTS}, draw ${DRAW_POINTS}, plus ${COMPLETION_BONUS} for completing every set`}>Pts</th>
              <th scope="col">W–L–D</th>
              <th scope="col" title="Games won and lost">Games</th>
              <th scope="col" title="Games won as a share of games played">Game%</th>
              <th scope="col" title="Scheduled sets still to play">Rem</th>
            </tr>
          </thead>
          <tbody>
            {players.map((r, i) => {
              /*
                The cutoff is drawn on the LAST ADVANCING ROW, from the configured count.

                Not row three, not row four — `group.advancing` comes from `advancingInGroup`, so a
                group of two in an archived season does not get a line drawn past its own end, and
                changing the advancement rule moves every line on the page.
              */
              const isCutoff = group.advancing > 0 && i === group.advancing - 1 && i < players.length - 1
              return (
                <tr
                  key={r.entrantId}
                  className={cn(
                    'gb-row',
                    i % 2 === 0 ? 'gb-row-odd' : 'gb-row-even',
                    i === 0 && 'gb-row-first',
                    isCutoff && 'gb-row-cutoff',
                    pinned === r.entrantId && 'gb-row-pinned',
                  )}
                  onClick={(e) => {
                    // A click on a name navigates; it is not a request to pin the row.
                    if ((e.target as HTMLElement).closest('a')) return
                    setPinned((cur) => (cur === r.entrantId ? null : r.entrantId))
                  }}
                >
                  <th scope="row" className="gb-who">
                    <span className="gb-id">
                      <span className="gb-rank">{i + 1}</span>
                      <Identity player={r} />
                    </span>
                    {/*
                      The cutoff caption, anchored to the row it belongs to.

                      It was a paragraph after the table, which put the words at the bottom of the
                      board while the gold line sat three rows up. Rendered here it travels with the
                      row, so when a result reorders the standings the label moves with the line
                      instead of staying where the old third place used to be.
                    */}
                    {isCutoff && <span className="gb-cutoff-tag" aria-hidden>Playoff cutoff</span>}
                  </th>

                  {players.map((c, j) => {
                    if (i === j) return <td key={c.entrantId} className="gb-diag" aria-hidden />
                    const cell = r.cells[c.entrantId]
                    return (
                      <td
                        key={c.entrantId}
                        className="gb-cell"
                        data-col={c.entrantId}
                        onPointerEnter={() => setCol(c.entrantId)}
                        onPointerLeave={() => setCol(null)}
                      >
                        <Score cell={cell} />
                      </td>
                    )
                  })}

                  <td className="gb-pts">{r.points}</td>
                  <td className="gb-stat">{r.wins}–{r.losses}–{r.draws}</td>
                  <td className="gb-stat">{r.gamesWon || r.gamesLost ? `${r.gamesWon}–${r.gamesLost}` : '–'}</td>
                  <td className="gb-stat">{r.gamePct == null ? '–' : `${r.gamePct}%`}</td>
                  {/* Remaining sets, counted from fixtures — never inferred from points or W–L–D. */}
                  <td className="gb-rem">{r.remaining}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <footer className="gb-legend">
        {/* Sourced from the scoring constants themselves, so the legend cannot describe a rule the
            engine is not applying. */}
        <span>Ordered by points — Win {WIN_POINTS}, Draw {DRAW_POINTS}, plus {COMPLETION_BONUS} for completing every set.</span>
        <span><b className="text-[var(--neon-cyan)]">9–1</b> win</span>
        <span><b>1–9</b> loss</span>
        <span><b className="text-[var(--gold)]">5–5</b> draw</span>
        <span><b>–</b> not played</span>
        <span><b className="italic">?</b> played, score not recorded</span>
        <span><b className="text-[color-mix(in_srgb,var(--hot-red)_72%,var(--steel))]">FF</b> forfeited</span>
        <span><b className="text-[var(--neon-cyan)]">W</b> won by forfeit</span>
        <span><b className="text-[var(--gold)]">—</b> gold line = playoff cutoff</span>
        <span><Lock className="inline size-3 text-[var(--gold)]" aria-hidden /> mathematically clinched</span>
      </footer>
    </section>
  )
}

/**
 * The left column's identity strip: avatar, handle, preferred name, and room for a clinch lock.
 *
 * Compact by design — the whole point is to stop the column reading as spreadsheet text without
 * making the row materially taller, so the avatar is 27px and the two text lines are tight.
 */
function Identity({ player }: { player: BoardPlayer }) {
  const inner = (
    <>
      <span
        className="gb-avatar"
        /* The one place a player's own colour is allowed on this page. */
        style={player.accent ? ({ '--gb-accent': player.accent } as React.CSSProperties) : undefined}
      >
        {player.avatarUrl ? (
          /*
            A plain <img>, and deliberately not next/image.

            An animated GIF has to be shown as a STILL here — thirty-two of them playing at once in
            one table is the thing the brief rules out — and the cheapest correct way to freeze one
            is to let the browser paint the first frame of a decoded image it is not animating.
            Rather than optimise the file (which would flatten it for the profile too), the table
            asks for a small render and the profile keeps the original moving.
          */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.avatarUrl}
            alt=""
            width={27}
            height={27}
            loading="lazy"
            decoding="async"
            data-animated={player.avatarAnimated ? 'true' : undefined}
          />
        ) : (
          <span className="gb-monogram" aria-hidden>{player.monogram}</span>
        )}
      </span>
      <span className={cn('gb-id-text', player.kickedOut && 'gb-id-kicked')}>
        <span className="gb-id-handle">
          {player.cueverseId}
          {player.clinchShown && (
            <Lock className="gb-lock inline size-3" aria-label="Mathematically clinched a playoff place" />
          )}
        </span>
        {player.preferredName && <span className="gb-id-name">{player.preferredName}</span>}
      </span>
    </>
  )

  if (!player.slug) return <span className="gb-id-link">{inner}</span>
  return (
    <Link
      href={`/players/${encodeURIComponent(player.slug)}`}
      className="gb-id-link"
      aria-label={`${player.cueverseId}${player.preferredName ? ` (${player.preferredName})` : ''} — open profile`}
    >
      {inner}
    </Link>
  )
}

/**
 * One result, from this row's point of view.
 *
 * Display only: text in a cell, no control, no affordance. Every state the data model can hold has
 * its own reading, including the two that used to share a dash — a fixture nobody has played yet,
 * and one that was played with no score written down.
 */
function Score({ cell }: { cell: BoardCell | undefined }) {
  if (!cell || cell.kind === 'no-fixture') {
    return <span className="gb-dash" title="No fixture between these players">·</span>
  }
  switch (cell.kind) {
    case 'unplayed':
      return <span className="gb-dash" title="Not played yet">–</span>
    case 'no-score':
      return <span className="gb-noscore" title="Played, score not recorded">?</span>
    case 'no-contest':
      return <span className="gb-void" title="No contest — closed out unplayed">·</span>
    case 'void':
      return <span className="gb-void" title="Voided">·</span>
    case 'forfeit':
      return cell.iForfeited
        ? <span className="gb-ff" title="Forfeited — did not play">FF</span>
        : <span className="gb-wf" title="Won by forfeit — opponent did not play">W</span>
    case 'score':
      return (
        <span className={cn('gb-score', cell.tone === 'w' ? 'gb-w' : cell.tone === 'l' ? 'gb-l' : 'gb-d')}>
          {cell.mine}–{cell.theirs}
        </span>
      )
    default:
      return <span className="gb-dash">–</span>
  }
}
