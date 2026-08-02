import { SeasonBracket } from '@/components/seasons/season-bracket'
import type { SeasonRound } from '@/lib/seasons/archive'
import type { BracketRound } from '@/lib/cups/fixtures'

function toBracketRounds(rounds: SeasonRound[]): BracketRound[] {
  return rounds.map((r) => ({
    name: r.name,
    matches: r.matches.map((m) => ({
      a: m.a ?? undefined,
      b: m.b ?? undefined,
      winner: m.winner ?? undefined,
      note: m.note,
    })),
  }))
}

/** Double-elimination playoff: winners bracket over the losers bracket, each drawn
 *  with the responsive SeasonBracket (fills width; scrolls only as a last resort). */
export function DoubleElimBracket({
  winners,
  losers,
}: {
  winners: SeasonRound[]
  losers: SeasonRound[]
}) {
  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow mb-3 text-gold">Winners Bracket</p>
        <SeasonBracket rounds={toBracketRounds(winners)} />
      </div>
      <div>
        <p className="eyebrow mb-3 text-muted-foreground">Losers Bracket</p>
        <SeasonBracket rounds={toBracketRounds(losers)} />
      </div>
    </div>
  )
}
