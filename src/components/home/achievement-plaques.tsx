import Link from 'next/link'

import type { Achievement } from '@/lib/achievements/types'

/**
 * Three achievements as medallion plaques.
 *
 * ── Everything here is drawn, not photographed ──────────────────────────────────────────────────
 * The ribbon, the medallion and the plaque edge are CSS and inline SVG. An image would have been
 * quicker and would have been wrong three times over: it would not follow a theme, it would blur on
 * a high-density screen, and it would bake gold into a file so an Owner could never change it. Every
 * colour here resolves through a token, and gold resolves through the one token that means a
 * championship.
 *
 * ── What the cards say is computed ──────────────────────────────────────────────────────────────
 * The title, the winner, the figure and the supporting line all come from the achievement engine.
 * Nothing on this component knows who holds a record, which is what stops the homepage drifting away
 * from the Achievements page as results land.
 */
export function AchievementPlaques({
  heading, caption, achievements, viewAllLabel, viewAllHref,
}: {
  heading: string
  caption: string
  achievements: Achievement[]
  viewAllLabel: string
  viewAllHref: string
}) {
  if (!achievements.length) return null

  return (
    <section
      aria-labelledby="home-achievements-heading"
      className="flex min-w-0 flex-col border border-[var(--line-strong)] bg-[var(--graphite)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <h2 id="home-achievements-heading" className="font-condensed text-[0.74rem] font-bold uppercase tracking-[0.26em] text-[var(--text-primary)]">
          {heading}
        </h2>
        <Link
          href={viewAllHref}
          className="inline-flex min-h-6 shrink-0 items-center py-1 font-condensed text-[0.66rem] font-bold uppercase tracking-[0.18em] text-[var(--steel-bright)] transition-colors hover:text-[var(--signal)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {viewAllLabel}
        </Link>
      </div>

      <ul className="grid flex-1 grid-cols-1 gap-3 p-3 sm:grid-cols-3">
        {achievements.map((a) => <Plaque key={a.id} achievement={a} />)}
      </ul>

      {caption && (
        <p className="border-t border-[var(--border)] px-4 py-2.5 text-center font-condensed text-[0.66rem] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
          {caption}
        </p>
      )}
    </section>
  )
}

function Plaque({ achievement }: { achievement: Achievement }) {
  const winner = achievement.winners[0] ?? null
  const extra = achievement.winners.length - 1
  const primary = winner ? (winner.cueverseId ?? winner.preferredName) : null
  const secondary = winner && winner.cueverseId ? winner.preferredName : null

  return (
    <li className="relative flex flex-col items-center overflow-hidden border border-[var(--border)] bg-[var(--surface-plaque)] px-3 pb-4 pt-0 text-center">
      <Ribbon />
      <Medallion />

      <h3 className="mt-2.5 font-condensed text-[0.7rem] font-bold uppercase leading-tight tracking-[0.14em] text-[var(--text-primary)]">
        {achievement.title}
      </h3>

      {/*
        A site-wide award has no holder, and the identity line is dropped rather than left blank.
        `achievement.siteWide` is the engine's own flag for exactly this.
      */}
      {primary && (
        <p className="mt-1.5 min-w-0 max-w-full">
          <IdentityLine href={winner?.href ?? null} primary={primary} secondary={secondary} />
          {extra > 0 && (
            <span className="mt-0.5 block text-[0.66rem] text-[var(--text-muted)]">
              +{extra} tied
            </span>
          )}
        </p>
      )}

      <Stat stat={achievement.stat} />

      <p className="mt-2 line-clamp-3 text-[0.68rem] leading-snug text-[var(--text-muted)]">
        {achievement.detail}
      </p>
    </li>
  )
}

/**
 * The headline figure, and the words after it.
 *
 * The engine hands over one pre-formatted string -- "83.2% WIN RATE", "27 IN A ROW", "5 FINALS
 * LOST" -- because that is the sentence the Achievements page prints. On a plaque a third of a
 * column wide it wraps to three lines of equal weight and stops reading as a number at all. So the
 * leading quantity is separated from the words that qualify it and set large; the words go beneath
 * it, small.
 *
 * Split rather than reformatted: the engine's string is still the source, and anything that does
 * not start with a quantity -- "Still nobody" -- is printed whole at the smaller size rather than
 * being forced into a shape it does not have.
 */
function Stat({ stat }: { stat: string }) {
  const match = /^([0-9][0-9.,%\u2013-]*%?)\s+(.+)$/.exec(stat.trim())
  const figure = match ? match[1] : stat.trim()
  const label = match ? match[2] : null

  return (
    <p className="mt-3">
      <span
        className="block font-condensed font-extrabold leading-none text-[var(--gold)] [font-variant-numeric:tabular-nums]"
        style={{ fontSize: label ? 'clamp(1.6rem, 2.6vw, 2.2rem)' : 'clamp(1rem, 1.5vw, 1.2rem)', overflowWrap: 'anywhere' }}
      >
        {figure}
      </span>
      {label && (
        <span className="mt-1 block font-condensed text-[0.66rem] font-bold uppercase leading-tight tracking-[0.16em] text-[var(--gold)]">
          {label}
        </span>
      )}
    </p>
  )
}

function IdentityLine({ href, primary, secondary }: { href: string | null; primary: string; secondary: string | null }) {
  const lines = (
    <>
      <span className="block truncate text-[0.82rem] font-semibold text-[var(--text-primary)]" title={primary}>
        {primary}
      </span>
      {secondary && (
        <span className="block truncate text-[0.7rem] italic text-[var(--text-muted)]" title={secondary}>
          {secondary}
        </span>
      )}
    </>
  )
  if (!href) return <span className="block min-w-0">{lines}</span>
  return (
    <Link
      href={href}
      className="block min-w-0 underline-offset-4 transition-colors hover:text-[var(--signal)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      {lines}
    </Link>
  )
}

/**
 * The banner across the top of a plaque.
 *
 * Drawn as one SVG path rather than three divs with borders, because the notch at the bottom is a
 * shape rather than a border trick and it has to stay crisp when the card is 96px wide on a phone
 * and 220px on a desktop. `preserveAspectRatio="none"` lets it stretch to whatever width it is
 * given; the notch depth is in the viewBox so it scales with it.
 */
function Ribbon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 14"
      preserveAspectRatio="none"
      className="h-4 w-full shrink-0 self-stretch"
      focusable="false"
    >
      <path d="M0 0 H100 V10 L50 14 L0 10 Z" fill="var(--signal-fill)" />
    </svg>
  )
}

/**
 * The medallion.
 *
 * Gold, and gold only ever means a championship on this site — which is exactly what an achievement
 * is, so the one token is correct here. The gradient is two stops of the same token mixed light and
 * dark rather than two hardcoded golds, so a theme that retunes gold retunes the medal with it.
 */
function Medallion() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 44 44"
      className="-mt-4 size-11 shrink-0 drop-shadow-[0_2px_6px_color-mix(in_oklab,var(--shadow-color)_55%,transparent)]"
      focusable="false"
    >
      <defs>
        <linearGradient id="ach-medal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="color-mix(in oklab, var(--gold) 78%, white)" />
          <stop offset="52%" stopColor="var(--gold)" />
          <stop offset="100%" stopColor="color-mix(in oklab, var(--gold) 62%, black)" />
        </linearGradient>
      </defs>
      <circle cx="22" cy="22" r="15" fill="var(--surface-inset)" stroke="url(#ach-medal)" strokeWidth="3" />
      <circle cx="22" cy="22" r="9.5" fill="none" stroke="url(#ach-medal)" strokeWidth="1.25" opacity="0.75" />
      {/* An eight-point star: the mark, kept simple so it reads at 44px and at 11px. */}
      <path
        d="M22 12 L24.2 19.4 L31.5 17.2 L27 22 L31.5 26.8 L24.2 24.6 L22 32 L19.8 24.6 L12.5 26.8 L17 22 L12.5 17.2 L19.8 19.4 Z"
        fill="url(#ach-medal)"
      />
    </svg>
  )
}
