import type { Metadata } from 'next'

import { getAchievements } from '@/lib/achievements'
import { AchievementCard } from '@/components/home/achievements-carousel'
import { CyberPage, CyberEmpty } from '@/components/cyber/primitives'

export const metadata: Metadata = {
  title: 'Achievements',
  description: 'Every award in the 8 Ball Registry, computed from the archive.',
}

/**
 * The full set.
 *
 * ── Why this is not a navigation tab ─────────────────────────────────────────────────────────────
 * It was asked for explicitly, and it is right: the awards are a diversion, not a section of the
 * site. They live on the homepage where somebody stumbles across them, and this page exists for the
 * reader who wants the rest after seeing five.
 *
 * ── Why it re-renders the same component ─────────────────────────────────────────────────────────
 * The card here is the identical component the carousel uses, and the figures come from the identical
 * cached service. A second implementation would be a second set of numbers, and the two would
 * disagree the first time a definition changed.
 */
export default async function AchievementsPage() {
  const achievements = await getAchievements('YAHOO')

  return (
    <CyberPage>
      <header className="mb-5 border-b-2 border-[var(--hot-red)] pb-3">
        <p className="eyebrow text-[var(--hot-red)]">The Registry</p>
        <h1 className="mt-1 font-display text-3xl font-bold uppercase tracking-tight">Achievements</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every award is computed from completed Seasons. Nothing here is written down in advance, so
          they change when the results do. Forfeits, byes and no-contests are counted the way the
          rulebook counts them, which is why some of these numbers are lower than you would guess.
        </p>
      </header>

      {achievements.length === 0 ? (
        <CyberEmpty
          title="No awards yet"
          body="Awards are derived from completed Seasons. Once a Season closes they appear here."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {achievements.map((a) => (
            <li key={a.id}>
              <AchievementCard achievement={a} />
            </li>
          ))}
        </ul>
      )}
    </CyberPage>
  )
}
