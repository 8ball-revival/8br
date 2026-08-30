import 'server-only'

/**
 * Achievements -- the real page body, extracted so the site builder can place it.
 *
 * Moved here VERBATIM from the route: the same imports, the same reads, the same markup. The builder
 * wraps this as a system module, so a builder-composed page runs the genuine surface -- the same
 * services, the same URL contract, the same behaviour -- rather than a copy that would drift from it.
 *
 * The route is now a shell that supplies metadata and hands the page to the builder.
 */

import type { Metadata } from 'next'

import { prisma } from '@/lib/prisma'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getPublicAchievements, listDefinitions } from '@/lib/achievements/service'
import type { DefinitionInput } from '@/lib/achievements/validate'
import { AchievementCard } from '@/components/home/achievements-carousel'
import { AchievementAdmin, type AdminRow } from '@/components/achievements/achievement-admin'
import type { EditorOptions } from '@/components/achievements/achievement-editor'
import { CyberPage, CyberEmpty } from '@/components/cyber/primitives'



/**
 * The full set, and — for staff — the place they are managed.
 *
 * ── One dataset ──────────────────────────────────────────────────────────────────────────────────
 * The cards here come from the same service the homepage strip reads, and are rendered by the same
 * component. A second list would drift, and the strip would eventually advertise an award this page
 * did not have.
 *
 * ── Admin is additive ────────────────────────────────────────────────────────────────────────────
 * A visitor sees exactly what they saw before. Staff get a management panel ABOVE the same grid, so
 * the effect of an edit is visible in its real context rather than in a preview pane pretending to
 * be one. Nothing about the public half changes shape depending on who is reading it.
 */

export async function AchievementsBody() {
  const access = await resolveStaffAccess()
  const isStaff = access.status === 'ok' && access.actor.can('manage_competitions')

  const achievements = await getPublicAchievements()

  /*
   * The admin payload is loaded ONLY for staff.
   *
   * Archived definitions, the full option lists and every stored rule are staff information. Loading
   * them for everybody and hiding them in the markup would ship the site's entire achievement
   * configuration to any visitor who opened the page source.
   */
  let adminRows: AdminRow[] = []
  let options: EditorOptions = { competitions: [], seasons: [], tournaments: [], players: [] }
  if (isStaff) {
    const [defs, competitions, seasons, tournaments, players] = await Promise.all([
      listDefinitions(),
      prisma.competitionSeries.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.season.findMany({
        where: { lifecycleState: 'COMPLETED' },
        select: { id: true, number: true, competitionYear: true },
        orderBy: [{ competitionYear: 'desc' }, { number: 'desc' }],
        take: 200,
      }),
      prisma.tournament.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }),
      prisma.player.findMany({
        where: { cueverseId: { not: null } },
        select: { id: true, cueverseId: true, primaryName: true },
        orderBy: { cueverseId: 'asc' },
        take: 1000,
      }),
    ])

    adminRows = defs.map((d): AdminRow => ({
      id: d.id,
      key: d.key,
      title: d.title,
      awardType: d.awardType,
      status: d.status,
      statistic: d.statistic,
      sortOrder: d.sortOrder,
      input: {
        title: d.title,
        flavorText: d.flavorText,
        description: d.description,
        awardType: d.awardType,
        status: d.status,
        displayFormat: d.displayFormat,
        statistic: d.statistic,
        scope: d.scope,
        competitionId: d.competitionId,
        seasonId: d.seasonId,
        tournamentId: d.tournamentId,
        stage: d.stage,
        winner: d.winner,
        minMatches: d.minMatches,
        minSeasons: d.minSeasons,
        minFinals: d.minFinals,
        minPlayoffMatches: d.minPlayoffMatches,
        tiePolicy: d.tiePolicy,
        tieBreakStat: d.tieBreakStat,
        manualPlayerId: d.manualPlayerId,
        manualValue: d.manualValue,
      } satisfies DefinitionInput,
    }))

    options = {
      competitions,
      seasons: seasons.map((s) => ({ id: s.id, label: `${s.competitionYear} · Season ${s.number}` })),
      tournaments: tournaments.map((t) => ({ id: t.id, label: t.name })),
      players: players.map((p) => ({
        id: p.id,
        // The handle leads, as everywhere else on the site.
        label: p.cueverseId === p.primaryName ? (p.cueverseId ?? '') : `${p.cueverseId} · ${p.primaryName}`,
      })),
    }
  }

  return (
    <CyberPage>
      <header className="mb-5 border-b-2 border-[var(--hot-red)] pb-3">
        <p className="eyebrow text-[var(--hot-red)]">The Registry</p>
        <h1 className="mt-1 font-display text-3xl font-bold uppercase tracking-tight">Achievements</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Automatic awards are computed from completed competitions and follow the data: correct a
          result and the holder changes on its own. Forfeits, byes and no-contests are counted the way
          the rulebook counts them, which is why some of these numbers are lower than you would guess.
        </p>
      </header>

      {isStaff && (
        <div className="mb-6">
          <AchievementAdmin
            rows={adminRows}
            options={options}
            canDelete={access.status === 'ok' && access.actor.isOwner}
          />
        </div>
      )}

      {achievements.length === 0 ? (
        <CyberEmpty
          title="No awards yet"
          body="Awards are derived from completed competitions. Once one closes they appear here."
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
