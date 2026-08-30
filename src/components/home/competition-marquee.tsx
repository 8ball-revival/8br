import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'

/**
 * The competition marquee: two announcements, one object.
 *
 * ── Why it is a single split panel and not two cards ─────────────────────────────────────────────
 * The homepage is already four rows of bordered panels, and a fifth pair would read as more of the
 * same — which is the opposite of what an announcement is for. So the two competitions share one
 * frame divided by a diagonal, each half leaning into the seam. Splitting rather than stacking also
 * settles the ranking question the layout would otherwise imply: neither is above the other.
 *
 * ── The seam ─────────────────────────────────────────────────────────────────────────────────────
 * Drawn with `clip-path` on the right half rather than with a rotated pseudo-element, so nothing
 * overflows the frame and nothing has to be hidden with `overflow`. The two halves overlap in the
 * grid — both occupy the same cell — and the clip decides which pixels belong to which. That keeps
 * the diagonal a single source of truth: one polygon, one angle, and the padding either side is
 * expressed in the same percentages, so the copy cannot collide with the join.
 *
 * On a phone the polygon flattens to a shallow horizontal wedge and the halves stack, because a
 * 60/40 diagonal across 375px leaves neither side a usable column.
 *
 * ── One link per half ────────────────────────────────────────────────────────────────────────────
 * The whole half is the anchor and the call to action is styled inside it, so there is one target,
 * one focus stop and one thing to announce. A button nested in a link would be two controls for one
 * destination, and a screen reader would offer both.
 *
 * ── The WCC logo is the supplied artwork ─────────────────────────────────────────────────────────
 * `wcc-logo.png` is the file as provided, pixel for pixel. It carries a real alpha channel — the
 * corners are fully transparent — so it needs no plate, no knockout and no blend mode to sit on the
 * dark panel; the glow behind it is a separate radial layer, not a modification of the mark. 8BRCAM
 * has no logo, and none is invented for it: its half leads with type instead.
 */
export function CompetitionMarquee() {
  return (
    <section
      aria-labelledby="marquee-heading"
      className="marquee cyber-clip relative isolate w-full overflow-hidden border border-[var(--line-strong)]"
    >
      <h2 id="marquee-heading" className="sr-only">Upcoming competitions</h2>

      {/*
        One cell, two occupants. Both halves are placed in the same grid area and the clip-path on
        the second decides where one ends and the other begins — so the diagonal is exact and there
        is no gap or overlap to tune.
      */}
      <div className="marquee-stage grid">
        <WccHalf />
        <BrcamHalf />
      </div>
    </section>
  )
}

function WccHalf() {
  return (
    <a
      href="https://www.worldcuechampionships.com/"
      target="_blank"
      rel="noopener noreferrer"
      className="marquee-half marquee-wcc group relative flex flex-col justify-center gap-1 focus-visible:outline-none"
    >
      {/* Decorative layers. Marked hidden so the announcement reads as text, not as scenery. */}
      <span aria-hidden className="marquee-wcc-glow" />
      <span aria-hidden className="marquee-streaks" />

      <div className="marquee-wcc-row relative flex items-center gap-5 sm:gap-8">
        <Image
          src="/assets/branding/wcc-logo.png"
          alt="World Cue Championships"
          width={770}
          height={790}
          sizes="(max-width: 640px) 7rem, (max-width: 1024px) 10rem, 14rem"
          priority={false}
          className="marquee-logo h-28 w-auto shrink-0 sm:h-36 lg:h-48"
        />
        <div className="min-w-0">
          <p className="marquee-kicker text-[var(--wcc-silver)]">World Cue Championships</p>
          <p className="marquee-title text-white">Season 1</p>
          <p className="marquee-status text-[var(--wcc-red)]">Starting soon</p>
          <p className="marquee-body">The inaugural season begins soon.</p>
          <span className="marquee-cta marquee-cta--wcc">
            Visit WCC website
            <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
          </span>
        </div>
      </div>
    </a>
  )
}

function BrcamHalf() {
  return (
    <Link
      href="/seasons"
      className="marquee-half marquee-brcam group relative flex flex-col justify-center gap-1 focus-visible:outline-none"
    >
      <span aria-hidden className="marquee-brcam-glow" />
      <span aria-hidden className="marquee-streaks marquee-streaks--brcam" />

      <div className="relative min-w-0">
        {/*
          No mark, because 8BRCAM does not have one. The wordmark IS the logo here: heavier, wider
          and larger than anything else on the panel, which is what gives this half the weight the
          crest gives the other one.
        */}
        <p className="marquee-wordmark">8BRCAM</p>
        <p className="marquee-title text-white">Season 2</p>
        <p className="marquee-status text-[var(--brcam-magenta)]">Coming soon</p>
        <p className="marquee-body">
          Hosted <em className="not-italic font-semibold text-[var(--brcam-teal)]">here</em> on 8 Ball Registry.
        </p>
        <span className="marquee-cta marquee-cta--brcam">
          View Season 2 here
          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        </span>
      </div>
    </Link>
  )
}
