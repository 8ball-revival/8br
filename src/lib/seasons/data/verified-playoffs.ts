/**
 * Hand-verified playoff brackets for pre-2012 seasons, where the archive stored
 * only pairings (no scores/winners). Sourced from the original 8brcam pages via the
 * Wayback Machine; player names come from the archive's seed→player mapping so the
 * display stays Name / ID. Keyed "seasonId:division"; applied over the generated
 * data in archive.ts (groups from the archive are kept). Names/handles verified.
 */
import type { SeasonMatch, SeasonRound, SeasonSlot } from '@/lib/seasons/archive'

const P = (name: string, handle: string, seed: number, score?: number): SeasonSlot => ({
  name,
  handle,
  seed,
  ...(score != null ? { score } : {}),
})
const BYE = (seed: number): SeasonSlot => ({ name: 'Bye', seed })
const MT = (
  a: SeasonSlot | null,
  b: SeasonSlot | null,
  winner: 'a' | 'b',
  note?: string,
): SeasonMatch => ({ a, b, winner, ...(note ? { note } : {}) })

// 2011 Season 5 · Division A — http://8brcam.com/archive/2011s5aP.html (Wayback)
const S2011_S5_A: SeasonRound[] = [
  {
    name: 'Round 1',
    matches: [
      MT(P('Jordy', 'xlx_skill_xlx', 1), BYE(32), 'a'),
      MT(P('Roy', 'precise.runner', 16, 2), P('Matt', '_Matt15_', 17, 7), 'b'),
      MT(P('Alex', 'experrt', 8), BYE(25), 'a'),
      MT(P('Steve', 'xll_lvlagic.lvlan_llx', 9), BYE(24), 'a'),
      MT(P('Scotty', 'xlx_s_p_g_xlx', 4), BYE(29), 'a'),
      MT(P('Scott', 'wyte.folks', 13, 7), P('Tanmay', 'x_therage', 20, 2), 'a'),
      MT(P('Uriel', 'PRO_BOY', 5), BYE(28), 'a'),
      MT(P('Jon', 'leeds_united14', 12, 4), P('Jamie', 'xlx_britishpoolking_xlx', 21, 7), 'b'),
      MT(P('MJ', 'MJ_The_King', 2), BYE(31), 'a'),
      MT(P('Si', 'xxl_machine_lxx', 15, 7), P('Ross', 'l_inland_taipan_l', 18, 5), 'a'),
      MT(P('CK', 'Xx_CK_xX', 7), BYE(26), 'a'),
      MT(P('Alex', 'x_i_am_me_x', 10, 5), P('Andy', 'HawkeyeStriker', 23, 7), 'b'),
      MT(P('Conor', 'c-b', 3), BYE(30), 'a'),
      MT(P('Pita', 'AzN_PrIdE_LuVa', 14, 7), P('Brent', 'sykology', 19, 5), 'a'),
      MT(P('Mina', 's.chooled', 6), BYE(27), 'a'),
      MT(P('Ant', 'manutd_', 11, 9), P('Stephen', 'l1_stephen_1', 22, 7), 'a'),
    ],
  },
  {
    name: 'Round 2',
    matches: [
      MT(P('Jordy', 'xlx_skill_xlx', 1, 2), P('Matt', '_Matt15_', 17, 7), 'b'),
      MT(P('Alex', 'experrt', 8, 4), P('Steve', 'xll_lvlagic.lvlan_llx', 9, 7), 'b'),
      MT(P('Scotty', 'xlx_s_p_g_xlx', 4, 2), P('Scott', 'wyte.folks', 13, 7), 'b'),
      MT(P('Uriel', 'PRO_BOY', 5, 3), P('Jamie', 'xlx_britishpoolking_xlx', 21, 7), 'b'),
      MT(P('MJ', 'MJ_The_King', 2, 2), P('Si', 'xxl_machine_lxx', 15, 7), 'b'),
      MT(P('CK', 'Xx_CK_xX', 7, 7), P('Andy', 'HawkeyeStriker', 23, 3), 'a'),
      MT(P('Conor', 'c-b', 3, 5), P('Pita', 'AzN_PrIdE_LuVa', 14, 7), 'b'),
      MT(P('Mina', 's.chooled', 6, 2), P('Ant', 'manutd_', 11, 7), 'b'),
    ],
  },
  {
    name: 'Quarter Finals',
    matches: [
      MT(P('Matt', '_Matt15_', 17, 3), P('Steve', 'xll_lvlagic.lvlan_llx', 9, 7), 'b'),
      MT(P('Scott', 'wyte.folks', 13, 9), P('Jamie', 'xlx_britishpoolking_xlx', 21, 11), 'b'),
      MT(P('Si', 'xxl_machine_lxx', 15, 7), P('CK', 'Xx_CK_xX', 7), 'b', 'CK advanced (DQ)'),
      MT(P('Pita', 'AzN_PrIdE_LuVa', 14, 8), P('Ant', 'manutd_', 11, 10), 'b'),
    ],
  },
  {
    name: 'Semi Finals',
    matches: [
      MT(P('Steve', 'xll_lvlagic.lvlan_llx', 9, 3), P('Jamie', 'xlx_britishpoolking_xlx', 21, 7), 'b'),
      MT(P('CK', 'Xx_CK_xX', 7, 7), P('Ant', 'manutd_', 11, 9), 'b'),
    ],
  },
  {
    name: 'Final',
    matches: [MT(P('Jamie', 'xlx_britishpoolking_xlx', 21, 3), P('Ant', 'manutd_', 11, 9), 'b')],
  },
]

export interface VerifiedPlayoff {
  champion: { name: string; handle?: string }
  runnerUp: { name: string; handle?: string }
  championConfidence: string
  playoff: { rounds: SeasonRound[] }
}

export const VERIFIED_PLAYOFFS: Record<string, VerifiedPlayoff> = {
  '2011-s5:A': {
    champion: { name: 'Ant', handle: 'manutd_' },
    runnerUp: { name: 'Jamie', handle: 'xlx_britishpoolking_xlx' },
    championConfidence: 'exact',
    playoff: { rounds: S2011_S5_A },
  },
}
