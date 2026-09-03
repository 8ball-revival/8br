import { prisma } from '@/lib/prisma'
import { getSeasonView } from '@/lib/seasons/service'
import { getSeasonGroupStage } from '@/lib/seasons/views'
import { seasonPlayoffRounds } from '@/lib/seasons/playoffs'
import {
  hasPublicPlayoffBracket,
} from '@/lib/seasons/browse'
import { CommandDeck } from '@/components/command-deck'
import { SeasonMasthead } from '@/components/seasons/season-masthead'
import { SeasonGroupsView, GroupsStillInProgress } from '@/components/seasons/season-presentation'
import { SeasonBracketPanel } from '@/components/seasons/season-bracket-panel'
import { DoubleElimBracket } from '@/components/brackets/double-elim-bracket'

/**
 * One Yahoo season, shown with the site's own Season presentations.
 *
 * ── Reused, not rebuilt ──────────────────────────────────────────────────────────────────────────
 * The masthead, the group tables and the bracket are the exact components `/seasons/[id]` renders.
 * An archive-specific simplification would have been quicker and would have drifted immediately:
 * a bye, a forfeit, an advancement marker or a tie-break would have had two implementations and one
 * of them would have been the one nobody maintained. Reading a 2007 season here should show what a
 * reader would see anywhere else on the site, because it is the same code.
 *
 * ── What is deliberately absent ──────────────────────────────────────────────────────────────────
 * No administrative controls. The Season page hands `canManageComp` to its playoff view for the
 * disclaimer editor; this is a read-only historical surface, so nothing here can edit anything, and
 * it does not need to be told who is looking.
 */
export async function YahooSeasonPanel({
  seasonId, view, group,
}: {
  seasonId: number
  view: 'groups' | 'playoffs'
  /** Preselected group code from the URL. Passed through for deep links. */
  group: string | null
}) {
  const season = await getSeasonView(seasonId)
  if (!season) {
    return <Missing>That season is not part of this archive.</Missing>
  }

  const [groups, bracketPublic] = await Promise.all([
    getSeasonGroupStage(season.id),
    hasPublicPlayoffBracket(season.id, season.lifecycleState),
  ])

  const champion = season.lifecycleState === 'COMPLETED' && (season.championHandle || season.championName)
    ? {
        cueverseId: season.championHandle,
        preferredName: season.championName,
        runnerUpCueverseId: season.runnerUpHandle,
        runnerUpName: season.runnerUpName,
        finalScore: season.finalScore,
      }
    : null

  return (
    <div className="min-w-0">
      <SeasonMasthead
        competitionName={season.competition.name}
        competitionShortName={season.competition.shortName}
        number={season.number}
        year={season.year}
        subtitle={season.subtitle}
        state={season.lifecycleState}
        platform={season.platform}
        division={season.division}
        ranked={season.ranked}
        /*
         * The playoffs link stays inside the archive.
         *
         * The masthead offers a way through to the bracket; on this page that has to be a view of
         * /yahoo rather than a jump to /seasons/<id>, or the control would quietly take the reader
         * out of the archive they are browsing.
         */
        playoffsHref={`/yahoo?season=${season.id}&view=playoffs`}
        champion={champion}
      />

      {season.description && (
        <p className="mt-4 max-w-3xl text-sm text-muted-foreground">{season.description}</p>
      )}

      <div className="mt-6 min-w-0">
        {view === 'groups' ? (
          <SeasonGroupsView
            seasonId={season.id}
            groups={group ? preferGroup(groups, group) : groups}
            groupStageGames={season.format.groupStageGames}
            state={season.lifecycleState}
          />
        ) : (
          <Playoffs
            seasonId={season.id}
            bracketPublic={bracketPublic}
            champion={champion && {
              cueverseId: champion.cueverseId,
              preferredName: champion.preferredName,
              runnerUp: champion.runnerUpCueverseId || champion.runnerUpName,
              finalScore: champion.finalScore,
            }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The requested group first, the rest after it.
 *
 * `?group=b` is a deep link into one table, and the groups view renders them all in order. Bringing
 * the requested one to the front honours the link without hiding the others or inventing a selector
 * the shared component does not have.
 */
function preferGroup<T extends { code: string }>(groups: T[], code: string): T[] {
  const want = code.trim().toLowerCase()
  const i = groups.findIndex((g) => g.code.toLowerCase() === want)
  if (i <= 0) return groups
  return [groups[i], ...groups.slice(0, i), ...groups.slice(i + 1)]
}

async function Playoffs({
  seasonId, bracketPublic, champion,
}: {
  seasonId: number
  bracketPublic: boolean
  champion: { cueverseId: string | null; preferredName: string | null; runnerUp: string | null; finalScore: string | null } | null
}) {
  if (!bracketPublic) return <GroupsStillInProgress />
  const rounds = await seasonPlayoffRounds(seasonId)
  if (rounds.length === 0) return <GroupsStillInProgress />

  const note = (await prisma.season.findUnique({
    where: { id: seasonId }, select: { playoffDisclaimer: true },
  }))?.playoffDisclaimer ?? null

  const matches = rounds.flatMap((r) => r.matches)
  const decided = matches.filter((m) => m.winner != null).length

  return (
    <div className="min-w-0">
      <CommandDeck
        eyebrow="Playoff Bracket"
        title="Playoffs"
        meta={rounds.map((r) => r.name).join(' → ')}
        stats={[
          { label: 'Rounds', value: rounds.length },
          { label: 'Matches', value: `${decided}/${matches.length}` },
          ...(champion?.finalScore ? [{ label: 'Final', value: champion.finalScore }] : []),
        ]}
      />
      {/*
        The same rule the Season page applies: anything with a losers bracket goes to the mirrored
        renderer, and every other Season keeps the single-column panel. Nothing about the archive
        changes which one is right — the bracket's own shape decides.
      */}
      {rounds.some((r) => r.section === 'LB')
        ? <DoubleElimBracket rounds={rounds} note={note} champion={champion?.preferredName ?? champion?.cueverseId ?? null} />
        : <SeasonBracketPanel rounds={rounds} note={note} champion={champion} />}
    </div>
  )
}

function Missing({ children }: { children: React.ReactNode }) {
  return (
    <p className="border border-dashed border-border px-3 py-10 text-center text-sm italic text-muted-foreground">
      {children}
    </p>
  )
}
