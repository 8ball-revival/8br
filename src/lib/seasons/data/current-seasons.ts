/**
 * Manually-entered current-era seasons (not in the historical archive export).
 * 2026 Season 1 = "8BR Retro Season 1 - Nostalgia Returns" (challonge rsy8er0):
 * 34 players, 5 groups of ~7 (double round-robin, top 4 advance), then a 20-player
 * DOUBLE-ELIMINATION final stage. Transcribed from Challonge on 2026-07-31 (group
 * standings + full winners/losers bracket, verified against final placings). Player
 * names are the Challonge participant names; identity merge to canonical profiles +
 * most-recent-ID display (e.g. neo -> Starkiller) is a follow-up.
 */
import type {
  ArchiveSeason,
  SeasonMatch,
  SeasonRound,
  SeasonStandingRow,
} from '@/lib/seasons/archive'

const row = (name: string, w: number, l: number, t: number, pts: number): SeasonStandingRow => ({
  name,
  played: w + l + t,
  wins: w,
  losses: l,
  draws: t,
  points: pts,
})

// Compact match builder: (nameA, seedA, scoreA, nameB, seedB, scoreB, winner)
const M = (
  an: string,
  as: number,
  asc: number,
  bn: string,
  bs: number,
  bsc: number,
  winner: 'a' | 'b',
): SeasonMatch => ({
  a: { name: an, seed: as, score: asc },
  b: { name: bn, seed: bs, score: bsc },
  winner,
})

const WINNERS: SeasonRound[] = [
  {
    name: 'Round 1',
    matches: [
      M('mynameiseskimo', 16, 7, 'fsm_brian', 17, 5, 'a'),
      M('jabronni16', 13, 7, 'o_aig_o', 20, 0, 'a'),
      M('_Tarantula_69', 15, 2, 'Faisal', 18, 7, 'b'),
      M('Mr.Gaz', 14, 9, 'Black_Jesus', 19, 7, 'a'),
    ],
  },
  {
    name: 'Round 2',
    matches: [
      M('sixohtwo', 1, 7, 'mynameiseskimo', 16, 3, 'a'),
      M('JC', 8, 4, 'leighjohn__', 9, 7, 'b'),
      M('neo', 4, 7, 'jabronni16', 13, 1, 'a'),
      M('l_Mr_CC_l', 5, 7, 'Adambuddy', 12, 0, 'a'),
      M('Easyrun', 2, 7, 'Faisal', 18, 2, 'a'),
      M('Iantunstall', 7, 7, 'Ogges', 10, 4, 'a'),
      M('Travis', 3, 7, 'Mr.Gaz', 14, 0, 'a'),
      M('S_U_K_I_O_O', 6, 7, 'Derrick', 11, 5, 'a'),
    ],
  },
  {
    name: 'Round 3',
    matches: [
      M('sixohtwo', 1, 9, 'leighjohn__', 9, 7, 'a'),
      M('neo', 4, 6, 'l_Mr_CC_l', 5, 8, 'b'),
      M('Easyrun', 2, 10, 'Iantunstall', 7, 8, 'a'),
      M('Travis', 3, 7, 'S_U_K_I_O_O', 6, 3, 'a'),
    ],
  },
  {
    name: 'Round 4',
    matches: [
      M('sixohtwo', 1, 9, 'l_Mr_CC_l', 5, 3, 'a'),
      M('Easyrun', 2, 9, 'Travis', 3, 4, 'a'),
    ],
  },
  {
    name: 'Semifinals',
    matches: [M('sixohtwo', 1, 10, 'Easyrun', 2, 8, 'a')],
  },
  {
    name: 'Finals',
    matches: [M('sixohtwo', 1, 9, 'Travis', 3, 1, 'a')],
  },
]

const LOSERS: SeasonRound[] = [
  {
    name: 'Losers Round 1',
    matches: [
      M('Derrick', 11, 7, 'fsm_brian', 17, 3, 'a'),
      M('Ogges', 10, 7, 'o_aig_o', 20, 0, 'a'),
      M('Adambuddy', 12, 0, '_Tarantula_69', 15, 7, 'b'),
    ],
  },
  {
    name: 'Losers Round 2',
    matches: [
      M('Mr.Gaz', 14, 0, 'Derrick', 11, 7, 'b'),
      M('Faisal', 18, 9, 'Ogges', 10, 7, 'a'),
      M('jabronni16', 13, 7, '_Tarantula_69', 15, 4, 'a'),
      M('mynameiseskimo', 16, 8, 'JC', 8, 6, 'a'),
    ],
  },
  {
    name: 'Losers Round 3',
    matches: [
      M('neo', 4, 0, 'Derrick', 11, 7, 'b'),
      M('leighjohn__', 9, 7, 'Faisal', 18, 3, 'a'),
      M('S_U_K_I_O_O', 6, 7, 'jabronni16', 13, 0, 'a'),
      M('Iantunstall', 7, 0, 'mynameiseskimo', 16, 7, 'b'),
    ],
  },
  {
    name: 'Losers Round 4',
    matches: [
      M('Derrick', 11, 5, 'leighjohn__', 9, 7, 'b'),
      M('S_U_K_I_O_O', 6, 7, 'mynameiseskimo', 16, 0, 'a'),
    ],
  },
  {
    name: 'Losers Round 5',
    matches: [
      M('Travis', 3, 9, 'leighjohn__', 9, 7, 'a'),
      M('l_Mr_CC_l', 5, 9, 'S_U_K_I_O_O', 6, 4, 'a'),
    ],
  },
  {
    name: 'Losers Round 6',
    matches: [M('Travis', 3, 10, 'l_Mr_CC_l', 5, 8, 'a')],
  },
  {
    name: 'Losers Round 7',
    matches: [M('Easyrun', 2, 5, 'Travis', 3, 9, 'b')],
  },
]

const SEASON_2026_S1: ArchiveSeason = {
  seasonId: '2026-s1',
  year: 2026,
  period: 1,
  label: '2026 Season 1',
  divisions: [
    {
      division: 'single',
      champion: { name: 'sixohtwo' },
      runnerUp: { name: 'Travis' },
      championConfidence: 'exact',
      bracketReconstructed: false,
      playoff: null,
      doubleElim: { winners: WINNERS, losers: LOSERS },
      groups: [
        {
          letter: 'A',
          rows: [
            row('sixohtwo', 11, 1, 0, 33),
            row('Mr.Gaz', 9, 2, 1, 28),
            row('Adambuddy', 7, 2, 3, 24),
            row('fsm_brian', 5, 4, 3, 18),
            row('Claimed', 3, 8, 1, 10),
            row('SabreGirl', 3, 9, 0, 9),
            row('Black_Ball', 0, 12, 0, 0),
          ],
        },
        {
          letter: 'B',
          rows: [
            row('neo', 8, 2, 2, 26),
            row('JC', 6, 3, 3, 21),
            row('jabronni16', 5, 2, 5, 20),
            row('mynameiseskimo', 5, 2, 5, 20),
            row('lilsparky67', 4, 4, 4, 16),
            row('Sterlo', 4, 8, 0, 12),
            row('Javi_8', 0, 11, 1, 1),
          ],
        },
        {
          letter: 'C',
          rows: [
            row('Travis', 10, 0, 2, 32),
            row('Iantunstall', 8, 1, 3, 27),
            row('_Tarantula_69', 6, 6, 0, 18),
            row('o_aig_o', 5, 5, 2, 17),
            row('Cameron90', 4, 6, 2, 14),
            row('Bye_all_c_ya', 2, 8, 2, 8),
            row('THE_PFB', 0, 9, 3, 3),
          ],
        },
        {
          letter: 'D',
          rows: [
            row('l_Mr_CC_l', 8, 2, 0, 24),
            row('S_U_K_I_O_O', 8, 2, 0, 24),
            row('Derrick', 7, 3, 0, 21),
            row('Black_Jesus', 4, 6, 0, 12),
            row('ArsH_', 1, 7, 2, 5),
            row('TrioTheLegend', 0, 8, 2, 2),
          ],
        },
        {
          letter: 'E',
          rows: [
            row('Easyrun', 11, 0, 1, 34),
            row('Ogges', 6, 2, 4, 22),
            row('leighjohn__', 5, 4, 3, 18),
            row('Faisal', 5, 5, 2, 17),
            row('TRICK__D', 4, 6, 2, 14),
            row('spc_shogun', 3, 6, 3, 12),
            row('JEFE_122', 0, 11, 1, 1),
          ],
        },
      ],
    },
  ],
}

// Top 4 of each 2026 group advanced to the playoffs (20 of 34).
for (const d of SEASON_2026_S1.divisions) {
  for (const g of d.groups) {
    g.rows.forEach((r, i) => {
      if (i < 4) r.advanced = true
    })
  }
}

export const CURRENT_SEASONS: ArchiveSeason[] = [SEASON_2026_S1]
