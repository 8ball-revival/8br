import type { Metadata } from 'next'
import Link from 'next/link'
import { Construction } from 'lucide-react'

import { CyberPage, CyberPanel, SectionHeading } from '@/components/cyber/primitives'
import { DiscordContactButton } from '@/components/identity/discord-contact-button'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach 8 Ball Registry while the site is under construction.',
  alternates: { canonical: '/contact' },
}

/**
 * Where "Submit ticket" and the footer's Contact link land.
 *
 * ── Why the Discord handle is shown as text AND as a button ──────────────────────────────────────
 * Discord has no reliable way to open a DM from a bare username — the `discord.com/users/…` route
 * takes a numeric snowflake, not a handle, so linking `…/users/stepatdis` produces a dead page. That
 * is exactly the fabricated-link problem the shared `DiscordContactButton` was written to avoid: it
 * copies the handle instead, and only opens a real URL when it is given one.
 *
 * So the icon does the useful thing (one click, handle on the clipboard) and the handle is printed
 * beside it so somebody can simply read it. The moment there is a snowflake ID or an invite link,
 * passing it to the same component turns the icon into a genuine link with no other change.
 *
 * ── Why the correction guidance stays ────────────────────────────────────────────────────────────
 * The homepage's archive notice points here with "Found a mistake?", so the page has to tell
 * somebody what a useful correction contains. It is short and sits under the contact details rather
 * than above them.
 */
const DISCORD_HANDLE = 'stepatdis'

const WHAT_TO_INCLUDE = [
  ['Where', 'The Season or Tournament, and the group or round. A link to the page is ideal.'],
  ['Who', 'The players involved, by CueVerse ID where you can. There are six players called Chris.'],
  ['What is wrong', 'The value as shown, and what it should be.'],
] as const

export default function ContactPage() {
  return (
    <CyberPage width="narrow">
      <header className="mb-5 border-b-2 border-[var(--hot-red)] pb-3">
        <p className="eyebrow text-[var(--hot-red)]">The Registry</p>
        <h1 className="mt-1 font-display text-3xl font-bold uppercase tracking-tight">Contact</h1>
      </header>

      <CyberPanel tone="danger" className="mb-4">
        <div className="flex items-start gap-3">
          <Construction className="mt-0.5 size-5 shrink-0 text-[var(--hot-red)]" aria-hidden />
          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[var(--hot-red)]">
              Under construction
            </h2>
            <p className="mt-2 text-sm text-foreground">
              8 Ball Registry is still being built. Pages, results and rankings are being added and
              corrected as the archive is reconstructed, so things will move around for a while yet.
            </p>
          </div>
        </div>
      </CyberPanel>

      <CyberPanel>
        <SectionHeading title="Get in touch" />
        <p className="mt-3 text-sm text-muted-foreground">
          For now the fastest way to reach the site is Discord.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/*
            The button copies the handle rather than pretending to open a DM — see the note above.
            The handle is printed next to it so it can also just be read.
          */}
          <DiscordContactButton discord={DISCORD_HANDLE} name="8 Ball Registry" />
          <span className="tabular select-all text-base font-bold text-[var(--cyan)]">
            {DISCORD_HANDLE}
          </span>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          The icon copies the handle to your clipboard. Discord cannot open a direct message from a
          username alone, so there is nothing to link to yet.
        </p>
      </CyberPanel>

      <CyberPanel className="mt-4">
        <SectionHeading title="Reporting an archive error" />
        <p className="mt-3 text-sm text-muted-foreground">
          Nearly fifty seasons were reconstructed by hand, so some of it is wrong. If you are
          reporting a mistake, these three things are what make it fixable:
        </p>
        <dl className="mt-3 space-y-3">
          {WHAT_TO_INCLUDE.map(([term, detail]) => (
            <div key={term}>
              <dt className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[var(--cyan)]">
                {term}
              </dt>
              <dd className="mt-0.5 text-sm text-foreground">{detail}</dd>
            </div>
          ))}
        </dl>
      </CyberPanel>

      <p className="mt-5 text-sm text-muted-foreground">
        Browsing for something specific?{' '}
        <Link href="/seasons" className="text-[var(--cyan)] underline-offset-2 hover:underline">
          Seasons
        </Link>
        {' · '}
        <Link href="/tournaments" className="text-[var(--cyan)] underline-offset-2 hover:underline">
          Tournaments
        </Link>
        {' · '}
        <Link href="/rankings" className="text-[var(--cyan)] underline-offset-2 hover:underline">
          Rankings
        </Link>
      </p>
    </CyberPage>
  )
}
