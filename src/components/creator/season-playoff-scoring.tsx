'use client'

/**
 * The Season's playoff scoring screen, with its actions already attached.
 *
 * `PlayoffScoring` is shared with Tournaments and takes the two actions it should call as an api,
 * so neither competition needs a copy of the screen. Building that api is the one step that has to
 * happen on the client: the actions live in a client module, and a server component that calls
 * `seasonScoringApi()` itself is asking the server to invoke a client function - which the dev
 * server tolerates and the production build refuses, so the failure only appears at deploy time.
 *
 * Tournaments reach the same screen through `TournamentLiveBracket`, which is a client component
 * and so can build the api inline. This is the Season's equivalent seam.
 */

import { PlayoffScoring, type ScoringRound } from './playoff-scoring'
import { seasonScoringApi } from './season-scoring-api'

export function SeasonPlayoffScoring({ rounds }: { rounds: ScoringRound[] }) {
  return <PlayoffScoring rounds={rounds} api={seasonScoringApi()} />
}
