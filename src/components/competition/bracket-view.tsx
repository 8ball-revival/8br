import type { PlayoffMatch } from '@prisma/client'

import { Card } from '@/components/ui/card'

/** Public read-only single-elimination bracket, laid out by round. */
export function BracketView({ matches }: { matches: PlayoffMatch[] }) {
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b)

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-6">
        {rounds.map((round) => {
          const roundMatches = matches.filter((m) => m.round === round).sort((a, b) => a.slot - b.slot)
          return (
            <div key={round} className="flex min-w-56 flex-col justify-around gap-4">
              <h3 className="eyebrow text-center text-muted-foreground">{roundName(round, rounds.length)}</h3>
              {roundMatches.map((m) => (
                <BracketMatchCard key={m.id} match={m} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BracketMatchCard({ match }: { match: PlayoffMatch }) {
  const decided = match.winnerRegistrationId != null
  const homeWon = decided && match.winnerRegistrationId === match.homeRegistrationId
  const awayWon = decided && match.winnerRegistrationId === match.awayRegistrationId
  return (
    <Card className="p-3">
      {match.label && <p className="mb-2 text-xs text-muted-foreground">{match.label}</p>}
      <Side name={match.homeUsername} seed={match.homeSeed} games={match.homeGames} won={homeWon} />
      <div className="my-1 border-t border-border" />
      <Side name={match.awayUsername} seed={match.awaySeed} games={match.awayGames} won={awayWon} />
    </Card>
  )
}

function Side({
  name,
  seed,
  games,
  won,
}: {
  name: string | null
  seed: number | null
  games: number | null
  won: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className={'inline-flex items-center gap-1.5 ' + (won ? 'font-semibold text-brand' : '')}>
        {seed != null && <span className="tabular text-xs text-muted-foreground">{seed}</span>}
        {name ?? <span className="text-muted-foreground italic">TBD</span>}
      </span>
      {games != null && <span className="tabular font-medium">{games}</span>}
    </div>
  )
}

function roundName(round: number, total: number): string {
  const fromEnd = total - round
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semifinals'
  if (fromEnd === 2) return 'Quarterfinals'
  return `Round ${round}`
}

export function isBracketEmpty(matches: PlayoffMatch[]): boolean {
  return matches.length === 0
}
