import type { Metadata } from 'next'
import Link from 'next/link'

import { CyberPage, CyberPanel, SectionHeading } from '@/components/cyber/primitives'

export const metadata: Metadata = {
  title: 'Report an error',
  description: 'Report an inaccuracy in the 8 Ball Registry archive.',
  alternates: { canonical: '/contact' },
}

/**
 * Where "Submit ticket" goes.
 *
 * ── Why this page exists rather than a ticket system ─────────────────────────────────────────────
 * The homepage now invites people to report archive errors, so that invitation needs somewhere real
 * to land. There is no ticketing system on this site, and building one — a collection, a status
 * workflow, an admin queue — is a large feature that nobody asked for. What a correction actually
 * needs is a message containing the right five facts, so this page asks for those five facts and
 * hands them to whatever channel is configured.
 *
 * ── The address is configuration, not a literal ──────────────────────────────────────────────────
 * `NEXT_PUBLIC_REPORT_EMAIL` supplies the destination. It is deliberately not hardcoded: inventing a
 * plausible-looking address would produce a button that silently goes nowhere, which is worse than
 * no button. With nothing configured the page says so plainly and still tells somebody what to
 * gather, so the report survives until there is a channel to send it to.
 */
const REPORT_EMAIL = process.env.NEXT_PUBLIC_REPORT_EMAIL?.trim() || null

const WHAT_TO_INCLUDE = [
  ['Where', 'The Season or Tournament, and the group or round if you know it. A link to the page is ideal.'],
  ['Who', 'The players involved, by CueVerse ID where you can — there are six players called Chris.'],
  ['What is wrong', 'The value as shown, and what it should be.'],
  ['How you know', 'A screenshot, an archived page, or simply that you were there. All three are useful.'],
] as const

export default function ContactPage() {
  const subject = encodeURIComponent('8 Ball Registry — archive correction')
  const body = encodeURIComponent(
    'Where (season/tournament, group or round):\n\n'
    + 'Who (players, CueVerse IDs):\n\n'
    + 'What is wrong (shown vs correct):\n\n'
    + 'How you know (link, screenshot, memory):\n\n',
  )

  return (
    <CyberPage width="narrow">
      <header className="mb-5 border-b-2 border-[var(--hot-red)] pb-3">
        <p className="eyebrow text-[var(--hot-red)]">The Registry</p>
        <h1 className="mt-1 font-display text-3xl font-bold uppercase tracking-tight">Report an error</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Nearly fifty seasons were reconstructed by hand from archived pages, bracket images and
          partial standings. Some of it is wrong. Telling us which part is the fastest way to fix it.
        </p>
      </header>

      <CyberPanel className="mb-4">
        <SectionHeading title="What to include" />
        <dl className="mt-3 space-y-3">
          {WHAT_TO_INCLUDE.map(([term, detail]) => (
            <div key={term}>
              <dt className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[var(--cyan)]">{term}</dt>
              <dd className="mt-0.5 text-sm text-foreground">{detail}</dd>
            </div>
          ))}
        </dl>
      </CyberPanel>

      <CyberPanel tone={REPORT_EMAIL ? 'default' : 'danger'}>
        <SectionHeading title="Send it" />
        {REPORT_EMAIL ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              This opens your mail client with the four headings already filled in.
            </p>
            <a
              href={`mailto:${REPORT_EMAIL}?subject=${subject}&body=${body}`}
              className="cyber-clip-sm mt-4 inline-flex items-center bg-[var(--acid)] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--acid-ink)] transition-colors hover:bg-[var(--acid-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              Open a correction report
            </a>
          </>
        ) : (
          <p className="mt-3 text-sm text-foreground">
            No reporting address is configured on this deployment yet, so there is nothing to send to
            from here. Gather the four things above and pass them to whoever runs the site — they are
            what a correction needs regardless of how it arrives.
          </p>
        )}
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
