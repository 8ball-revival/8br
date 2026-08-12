/**
 * Cups data (dev fixture). Variety competitions — prize events, 2v2, and special
 * formats — kept separate from league Seasons. Filled in one cup at a time.
 * Swap getCups()/getCup() for a real Payload/Prisma query later; components stay.
 */
import { scrubForPublic } from '@/lib/stats/identity'

export interface CupCompetitor {
  name: string
  handle?: string
}

/** One competitor slot inside a bracket match. */
export interface BracketSlot {
  name?: string
  handle?: string
  seed?: number
  score?: number
  /** Team-format cups: the roster shown beneath the team name (name is the team name). */
  members?: { name: string; handle?: string; slug?: string }[]
}

export interface BracketMatch {
  a?: BracketSlot
  b?: BracketSlot
  winner?: 'a' | 'b'
  note?: string // e.g. "Walkover", "Forfeit"
}

export interface BracketRound {
  name: string // e.g. "Quarterfinals", "Semifinals", "Final"
  matches: BracketMatch[]
}

/** Team-format (e.g. 5v5) support: a tie is a set of individual player matches. */
export interface TiePlayer {
  name: string
  handle?: string
  captain?: boolean
}

export interface TieMatch {
  home: TiePlayer
  away: TiePlayer
  homeScore?: string // number as string, or "W"/"DQ"; omit both for an unplayed match
  awayScore?: string
  note?: string
}

export interface TeamTie {
  round: string // "Semi Final", "Final"
  home: string // team name
  away: string
  homeWins: number
  awayWins: number
  winner: 'home' | 'away'
  matches: TieMatch[]
}

export interface Cup {
  number: number
  name: string
  format: string // category for the badge: Prize, 2v2, 6oh2, dbt, …
  year?: number
  date?: string // exact start date (ISO) when known — enables the true rolling window
  status: 'completed' | 'live'
  entrants?: number
  champion?: CupCompetitor
  runnerUp?: CupCompetitor
  finalScore?: string
  currentRound?: string // for live cups, e.g. "Semifinals"
  bracket?: BracketRound[] // real round-by-round results when available (single-elim)
  teamTies?: TeamTie[] // team-format cups (5v5, 2v2): per-tie individual match logs
  // Double-elimination cups: winners + losers brackets and the grand final.
  winnersBracket?: BracketRound[]
  losersBracket?: BracketRound[]
  grandFinal?: BracketRound[]
  thirdPlace?: CupCompetitor
}

const CUPS: Cup[] = [
  {
    number: 1,
    name: 'The 5v5 Cup',
    format: '5v5',
    year: 2006,
    status: 'completed',
    // 4-team knockout. Transcribed from the original 8brcam 5v5 playoff page
    // (Wayback). Champion Chelsea over Barcelona 3–1 in the final.
    champion: { name: 'Chelsea' },
    runnerUp: { name: 'Barcelona' },
    finalScore: '3–1',
    bracket: [
      {
        name: 'Semi Finals',
        matches: [
          { a: { name: 'Boca Juniors', seed: 1, score: 2 }, b: { name: 'Chelsea', seed: 4, score: 3 }, winner: 'b' },
          { a: { name: 'Barcelona', seed: 2, score: 3 }, b: { name: 'GrassHoppers', seed: 3, score: 2 }, winner: 'a' },
        ],
      },
      {
        name: 'Final',
        matches: [{ a: { name: 'Chelsea', score: 3 }, b: { name: 'Barcelona', score: 1 }, winner: 'a' }],
      },
    ],
    teamTies: [
      {
        round: 'Semi Final',
        home: 'Boca Juniors',
        away: 'Chelsea',
        homeWins: 2,
        awayWins: 3,
        winner: 'away',
        matches: [
          { home: { name: 'Drew', handle: 'georgiapoolking' }, away: { name: 'Bill', handle: 'MOLSON__CANADIAN', captain: true }, homeScore: '2', awayScore: '5' },
          { home: { name: 'Scotty', handle: 'xlx_southside_pool_genius_xlx' }, away: { name: 'Mike', handle: 'xps_coma' }, homeScore: '3', awayScore: '5' },
          { home: { name: 'Jeremy', handle: 'lxl_jerm_is_evil_lxl' }, away: { name: 'Lara', handle: 'fine__69' }, homeScore: 'DQ', awayScore: 'W' },
          { home: { name: 'Jamie', handle: 'xlx_britishpoolking_xlx', captain: true }, away: { name: 'Jason', handle: 'JaseZ' }, homeScore: '5', awayScore: '4' },
          { home: { name: 'Pete', handle: 'VvPetevV' }, away: { name: 'Aldo', handle: 'mtvaldo' }, homeScore: '5', awayScore: '1' },
        ],
      },
      {
        round: 'Semi Final',
        home: 'Barcelona',
        away: 'GrassHoppers',
        homeWins: 3,
        awayWins: 2,
        winner: 'home',
        matches: [
          { home: { name: 'Mike', handle: 'Drummer_Dude' }, away: { name: 'Don', handle: 'poker_hustler21', captain: true }, homeScore: 'W', awayScore: 'DQ' },
          { home: { name: 'Chris', handle: 'chris.dogg', captain: true }, away: { name: 'Andy', handle: 'HawkeyeStriker' }, homeScore: '5', awayScore: '2' },
          { home: { name: 'Jim', handle: 'unclejimjim69' }, away: { name: 'Chris', handle: 'cubs_fan_21_07_04' }, homeScore: '2', awayScore: '5' },
          { home: { name: 'Mark', handle: 'the_deathbat' }, away: { name: 'Kenny', handle: 'the_pool_apprentice' }, homeScore: 'DQ', awayScore: 'W' },
          { home: { name: 'Walter', handle: 'kidfromperu' }, away: { name: 'Ryan', handle: 'kula.' }, homeScore: 'W', awayScore: 'DQ' },
        ],
      },
      {
        round: 'Final',
        home: 'Barcelona',
        away: 'Chelsea',
        homeWins: 1,
        awayWins: 3,
        winner: 'away',
        matches: [
          { home: { name: 'Jim', handle: 'unclejimjim69' }, away: { name: 'Bill', handle: 'MOLSON__CANADIAN', captain: true }, homeScore: '4', awayScore: '5' },
          { home: { name: 'Mike', handle: 'Drummer_Dude' }, away: { name: 'Mike', handle: 'xps_coma' }, homeScore: '2', awayScore: '5' },
          { home: { name: 'Mark', handle: 'the_deathbat' }, away: { name: 'Lara', handle: 'fine__69' }, note: 'Not played' },
          { home: { name: 'Chris', handle: 'chris.dogg', captain: true }, away: { name: 'Jason', handle: 'JaseZ' }, homeScore: '5', awayScore: '1' },
          { home: { name: 'Walter', handle: 'kidfromperu' }, away: { name: 'Aldo', handle: 'mtvaldo' }, homeScore: '4', awayScore: '5' },
        ],
      },
    ],
  },
  {
    number: 2,
    name: 'Prize',
    format: 'Prize',
    year: 2006,
    status: 'completed',
    entrants: 32,
    champion: { name: 'Conor', handle: 'xlx_nub_xlx' },
    runnerUp: { name: 'Craig', handle: 'c_l2_a_i_g' },
    // 32-draw single-elim, transcribed from the original 8brcam prize-playoff page
    // (Wayback). Conor def. Craig in the final (final score not recorded on the page).
    bracket: [
      {
        name: 'Round 1',
        matches: [
          { a: { name: 'Ryan', handle: 'Outlaw_Joker', seed: 1 }, b: { name: 'Bye', seed: 32 }, winner: 'a' },
          { a: { name: 'Luis', handle: 'real_creampuff', seed: 16, score: 0 }, b: { name: 'Tom', handle: 'tomdapom', seed: 17, score: 7 }, winner: 'b' },
          { a: { name: 'Krunal', handle: '_Woo_Hoo_', seed: 8 }, b: { name: 'Bye', seed: 25 }, winner: 'a' },
          { a: { name: 'Mike B', handle: 'soo.clear', seed: 9 }, b: { name: 'Bye', seed: 24 }, winner: 'a' },
          { a: { name: 'Craig', handle: 'c_l2_a_i_g', seed: 4 }, b: { name: 'Bye', seed: 29 }, winner: 'a' },
          { a: { name: 'Craig', handle: 'sicc.godd', seed: 13, score: 4 }, b: { name: 'Ryan', handle: 'kula.', seed: 20, score: 7 }, winner: 'b' },
          { a: { name: 'Billy', handle: 'MOLSON__CANADIAN', seed: 5 }, b: { name: 'Bye', seed: 28 }, winner: 'a' },
          { a: { name: 'british-pool_wizard', handle: 'british_pool_wizard', seed: 12, score: 7 }, b: { name: 'Gus', handle: 'XX_APOCALIPSYS_XX', seed: 21, score: 3 }, winner: 'a' },
          { a: { name: 'O.Wnage', handle: 'o.wnage', seed: 2 }, b: { name: 'Bye', seed: 31 }, winner: 'a' },
          { a: { name: 'Chirag', handle: 'jabronni16', seed: 15, score: 6 }, b: { name: 'Brian', handle: 'cubskilla87', seed: 18, score: 8 }, winner: 'b' },
          { a: { name: 'James', handle: 'cue.ball', seed: 7 }, b: { name: 'Bye', seed: 26 }, winner: 'a' },
          { a: { name: 'Andy', handle: 'pool_warrior2002', seed: 10 }, b: { name: 'Bye', seed: 23 }, winner: 'a' },
          { a: { name: 'Jamie', handle: 'xlx_britishpoolking_xlx', seed: 3 }, b: { name: 'Bye', seed: 30 }, winner: 'a' },
          { a: { name: 'Kevin', handle: 'krazy_kevy', seed: 14 }, b: { name: 'Conor', handle: 'xlx_nub_xlx', seed: 19 }, winner: 'b', note: 'Walkover' },
          { a: { name: 'Adam', handle: 'owned_ggs', seed: 6 }, b: { name: 'Bye', seed: 27 }, winner: 'a' },
          { a: { name: 'Chris', handle: 'chris.dogg', seed: 11 }, b: { name: 'Bye', seed: 22 }, winner: 'a' },
        ],
      },
      {
        name: 'Round 2',
        matches: [
          { a: { name: 'Ryan', handle: 'Outlaw_Joker' }, b: { name: 'Tom', handle: 'tomdapom' }, winner: 'b', note: 'Walkover' },
          { a: { name: 'Krunal', handle: '_Woo_Hoo_', score: 4 }, b: { name: 'Mike B', handle: 'soo.clear', score: 7 }, winner: 'b' },
          { a: { name: 'Craig', handle: 'c_l2_a_i_g', score: 7 }, b: { name: 'Ryan', handle: 'kula.', score: 5 }, winner: 'a' },
          { a: { name: 'Billy', handle: 'MOLSON__CANADIAN', score: 4 }, b: { name: 'british-pool_wizard', handle: 'british_pool_wizard', score: 7 }, winner: 'b' },
          { a: { name: 'O.Wnage', handle: 'o.wnage', score: 3 }, b: { name: 'Brian', handle: 'cubskilla87', score: 7 }, winner: 'b' },
          { a: { name: 'James', handle: 'cue.ball', score: 5 }, b: { name: 'Andy', handle: 'pool_warrior2002', score: 7 }, winner: 'b' },
          { a: { name: 'Jamie', handle: 'xlx_britishpoolking_xlx', score: 6 }, b: { name: 'Conor', handle: 'xlx_nub_xlx', score: 8 }, winner: 'b' },
          { a: { name: 'Adam', handle: 'owned_ggs', score: 5 }, b: { name: 'Chris', handle: 'chris.dogg', score: 7 }, winner: 'b' },
        ],
      },
      {
        name: 'Quarter Finals',
        matches: [
          { a: { name: 'Tom', handle: 'tomdapom', score: 3 }, b: { name: 'Mike B', handle: 'soo.clear', score: 7 }, winner: 'b' },
          { a: { name: 'Craig', handle: 'c_l2_a_i_g', score: 7 }, b: { name: 'british-pool_wizard', handle: 'british_pool_wizard', score: 2 }, winner: 'a' },
          { a: { name: 'Brian', handle: 'cubskilla87', score: 7 }, b: { name: 'Andy', handle: 'pool_warrior2002', score: 3 }, winner: 'a' },
          { a: { name: 'Conor', handle: 'xlx_nub_xlx', score: 7 }, b: { name: 'Chris', handle: 'chris.dogg', score: 5 }, winner: 'a' },
        ],
      },
      {
        name: 'Semi Finals',
        matches: [
          { a: { name: 'Mike B', handle: 'soo.clear', score: 8 }, b: { name: 'Craig', handle: 'c_l2_a_i_g', score: 10 }, winner: 'b' },
          { a: { name: 'Brian', handle: 'cubskilla87', score: 10 }, b: { name: 'Conor', handle: 'xlx_nub_xlx', score: 12 }, winner: 'b' },
        ],
      },
      {
        name: 'Final',
        matches: [
          { a: { name: 'Craig', handle: 'c_l2_a_i_g' }, b: { name: 'Conor', handle: 'xlx_nub_xlx' }, winner: 'b' },
        ],
      },
    ],
  },
  {
    number: 3,
    name: 'Prize',
    format: 'Prize',
    status: 'completed',
    champion: { name: 'Zack', handle: 'fsm_fear' },
    // Bracket/entrants/year pending — add when the page is found.
  },
  {
    number: 4,
    name: 'Prize',
    format: 'Prize',
    year: 2008,
    status: 'completed',
    champion: { name: 'Luis', handle: 'real_creampuff' },
    runnerUp: { name: 'Stu', handle: 'zl_stu_lz' },
    // 64-draw. Bracket pending — the only Wayback capture mangles the middle of the
    // table into one row; champion/finalist recovered, full bracket needs a clean source.
  },
  {
    number: 5,
    name: 'Prize',
    format: 'Prize',
    year: 2009,
    status: 'completed',
    // 64-draw single-elim, reconstructed from the Wayback bracket page.
    entrants: 64,
    champion: { name: 'Luis', handle: 'deep.cerebro' },
    runnerUp: { name: 'Noobish.Styles', handle: 'noobish.styles' },
    finalScore: '14–12',
    bracket: [
      {
        name: 'Round 1',
        matches: [
          { a: { name: 'Luis', handle: 'deep.cerebro', seed: 1 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Tino', handle: 'TlNO_NICA', seed: 32, score: 7 }, b: { name: 'Shan', handle: 'nullified', seed: 33, score: 0 }, winner: 'a' },
          { a: { name: 'Jon', handle: 'leeds_united14', seed: 16 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Gamblin_Man_', handle: 'Gamblin_Man_', seed: 17 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Fsm_fearz', handle: 'fsm_fearz', seed: 8 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Tanmay', handle: 'x_therage', seed: 25, score: 7 }, b: { name: 'Syco Kyle', handle: 'import_', seed: 40, score: 0 }, winner: 'a' },
          { a: { name: 'Tyler', handle: 'bongman420_', seed: 9 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Scotty', handle: 'xlx_s_p_g_xlx', seed: 24, score: 7 }, b: { name: 'Koty', handle: 'nwb', seed: 41, score: 4 }, winner: 'a' },
          { a: { name: 'Chris', handle: 'chris.dogg', seed: 4 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Adam', handle: 'adambuddy', seed: 29, score: 7 }, b: { name: 'Alex', handle: 'ymp', seed: 36, score: 0 }, winner: 'a' },
          { a: { name: 'Kevin', handle: 'sixohtwo', seed: 13 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Matt', handle: 'superstaaaar', seed: 20, score: 7 }, b: { name: 'Josh', handle: 'midwestern_pool_champ', seed: 45, score: 0 }, winner: 'a' },
          { a: { name: 'MJ', handle: 'MJ_The_King', seed: 5 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Anil', handle: 'AaaaaaaaaNiL', seed: 28, score: 1 }, b: { name: 'Craig', handle: 'mvp.chiddy', seed: 37, score: 7 }, winner: 'b' },
          { a: { name: 'Chirag', handle: 'jabronni16', seed: 12 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Mario', handle: 'msc_masta', seed: 21, score: 0 }, b: { name: 'Stephen', handle: 'scottish.king', seed: 44, score: 7 }, winner: 'b' },
          { a: { name: 'Ant', handle: 'mvp_sicc', seed: 2 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Lewis', handle: 'Lewissss', seed: 31, score: 0 }, b: { name: 'Matt', handle: 'jaded_karma', seed: 34, score: 7 }, winner: 'b' },
          { a: { name: 'Chris', handle: 'new.zealand', seed: 15 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'CK', handle: 'Xx_CK_xX', seed: 18, score: 7 }, b: { name: 'kerryanne_24 W/C', handle: 'kerryanne_24', seed: 47, score: 0 }, winner: 'a' },
          { a: { name: 'PC', handle: 'p00l_charlie', seed: 7 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Jeremy', handle: 'pro.jeremy', seed: 26, score: 0 }, b: { name: 'Sean', handle: 'lilsparky67', seed: 39, score: 0 }, winner: 'a' },
          { a: { name: 'Craig', handle: 'c_l2_a_i_g', seed: 10 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Noobish.Styles', handle: 'noobish.styles', seed: 23, score: 7 }, b: { name: 'Mvp_artist', handle: 'mvp_artist', seed: 42, score: 4 }, winner: 'a' },
          { a: { name: 'James', handle: 'cue.ball', seed: 3 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Todd', handle: 'mvp_todd', seed: 30, score: 7 }, b: { name: 'Ketan', handle: 'll_ketan_ll', seed: 35, score: 0 }, winner: 'a' },
          { a: { name: 'Brian', handle: 'cubskilla87', seed: 14 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Jamie', handle: 'xlx_britishpoolking_xlx', seed: 19, score: 1 }, b: { name: 'Andy', handle: 'Pool_Warrior2002', seed: 46, score: 7 }, winner: 'b' },
          { a: { name: 'Si', handle: 'xxx_thepower_xxx', seed: 6 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Josh', handle: 'x_psychopath.unleashed_x', seed: 27, score: 7 }, b: { name: 'Crespo', handle: '_carnages', seed: 38, score: 0 }, winner: 'a' },
          { a: { name: 'Stu', handle: 'zl_stu_lz', seed: 11 }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Kenny', handle: 'the_pool_professor', seed: 22, score: 0 }, b: { name: 'Nelson', handle: 'Diosmaradonaforever', seed: 43, score: 7 }, winner: 'b' },
        ],
      },
      {
        name: 'Round 2',
        matches: [
          { a: { name: 'Luis', handle: 'deep.cerebro', seed: 1, score: 7 }, b: { name: 'Tino', handle: 'TlNO_NICA', seed: 32, score: 3 }, winner: 'a' },
          { a: { name: 'Jon', handle: 'leeds_united14', seed: 16, score: 5 }, b: { name: 'Gamblin_Man_', handle: 'Gamblin_Man_', seed: 17, score: 7 }, winner: 'b' },
          { a: { name: 'Fsm_fearz', handle: 'fsm_fearz', seed: 8, score: 0 }, b: { name: 'Tanmay', handle: 'x_therage', seed: 25, score: 7 }, winner: 'b' },
          { a: { name: 'Tyler', handle: 'bongman420_', seed: 9, score: 0 }, b: { name: 'Scotty', handle: 'xlx_s_p_g_xlx', seed: 24, score: 7 }, winner: 'b' },
          { a: { name: 'Chris', handle: 'chris.dogg', seed: 4, score: 6 }, b: { name: 'Adam', handle: 'adambuddy', seed: 29, score: 8 }, winner: 'b' },
          { a: { name: 'Kevin', handle: 'sixohtwo', seed: 13, score: 6 }, b: { name: 'Matt', handle: 'superstaaaar', seed: 20, score: 8 }, winner: 'b' },
          { a: { name: 'MJ', handle: 'MJ_The_King', seed: 5, score: 9 }, b: { name: 'Craig', handle: 'mvp.chiddy', seed: 37, score: 7 }, winner: 'a' },
          { a: { name: 'Chirag', handle: 'jabronni16', seed: 12, score: 8 }, b: { name: 'Stephen', handle: 'scottish.king', seed: 44, score: 6 }, winner: 'a' },
          { a: { name: 'Ant', handle: 'mvp_sicc', seed: 2, score: 7 }, b: { name: 'Matt', handle: 'jaded_karma', seed: 34, score: 4 }, winner: 'a' },
          { a: { name: 'Chris', handle: 'new.zealand', seed: 15, score: 0 }, b: { name: 'CK', handle: 'Xx_CK_xX', seed: 18, score: 7 }, winner: 'b' },
          { a: { name: 'PC', handle: 'p00l_charlie', seed: 7, score: 0 }, b: { name: 'Jeremy', handle: 'pro.jeremy', seed: 26, score: 0 }, winner: 'b' },
          { a: { name: 'Craig', handle: 'c_l2_a_i_g', seed: 10, score: 0 }, b: { name: 'Noobish.Styles', handle: 'noobish.styles', seed: 23, score: 7 }, winner: 'b' },
          { a: { name: 'James', handle: 'cue.ball', seed: 3, score: 0 }, b: { name: 'Todd', handle: 'mvp_todd', seed: 30, score: 7 }, winner: 'b' },
          { a: { name: 'Brian', handle: 'cubskilla87', seed: 14, score: 6 }, b: { name: 'Andy', handle: 'Pool_Warrior2002', seed: 46, score: 8 }, winner: 'b' },
          { a: { name: 'Si', handle: 'xxx_thepower_xxx', seed: 6, score: 7 }, b: { name: 'Josh', handle: 'x_psychopath.unleashed_x', seed: 27, score: 1 }, winner: 'a' },
          { a: { name: 'Stu', handle: 'zl_stu_lz', seed: 11, score: 7 }, b: { name: 'Nelson', handle: 'Diosmaradonaforever', seed: 43, score: 4 }, winner: 'a' },
        ],
      },
      {
        name: 'Round 3',
        matches: [
          { a: { name: 'Luis', handle: 'deep.cerebro', seed: 1, score: 7 }, b: { name: 'Gamblin_Man_', handle: 'Gamblin_Man_', seed: 17, score: 3 }, winner: 'a' },
          { a: { name: 'Tanmay', handle: 'x_therage', seed: 25, score: 2 }, b: { name: 'Scotty', handle: 'xlx_s_p_g_xlx', seed: 24, score: 7 }, winner: 'b' },
          { a: { name: 'Adam', handle: 'adambuddy', seed: 29, score: 2 }, b: { name: 'Matt', handle: 'superstaaaar', seed: 20, score: 7 }, winner: 'b' },
          { a: { name: 'MJ', handle: 'MJ_The_King', seed: 5, score: 7 }, b: { name: 'Chirag', handle: 'jabronni16', seed: 12, score: 4 }, winner: 'a' },
          { a: { name: 'Ant', handle: 'mvp_sicc', seed: 2, score: 7 }, b: { name: 'CK', handle: 'Xx_CK_xX', seed: 18, score: 2 }, winner: 'a' },
          { a: { name: 'Jeremy', handle: 'pro.jeremy', seed: 26, score: 7 }, b: { name: 'Noobish.Styles', handle: 'noobish.styles', seed: 23, score: 9 }, winner: 'b' },
          { a: { name: 'Todd', handle: 'mvp_todd', seed: 30, score: 7 }, b: { name: 'Andy', handle: 'Pool_Warrior2002', seed: 46, score: 2 }, winner: 'a' },
          { a: { name: 'Si', handle: 'xxx_thepower_xxx', seed: 6, score: 8 }, b: { name: 'Stu', handle: 'zl_stu_lz', seed: 11, score: 10 }, winner: 'b' },
        ],
      },
      {
        name: 'Quarter Finals',
        matches: [
          { a: { name: 'Luis', handle: 'deep.cerebro', seed: 1, score: 10 }, b: { name: 'Scotty', handle: 'xlx_s_p_g_xlx', seed: 24, score: 8 }, winner: 'a' },
          { a: { name: 'Matt', handle: 'superstaaaar', seed: 20, score: 5 }, b: { name: 'MJ', handle: 'MJ_The_King', seed: 5, score: 9 }, winner: 'b' },
          { a: { name: 'Ant', handle: 'mvp_sicc', seed: 2, score: 9 }, b: { name: 'Noobish.Styles', handle: 'noobish.styles', seed: 23, score: 11 }, winner: 'b' },
          { a: { name: 'Todd', handle: 'mvp_todd', seed: 30, score: 3 }, b: { name: 'Stu', handle: 'zl_stu_lz', seed: 11, score: 9 }, winner: 'b' },
        ],
      },
      {
        name: 'Semi Finals',
        matches: [
          { a: { name: 'Luis', handle: 'deep.cerebro', seed: 1, score: 9 }, b: { name: 'MJ', handle: 'MJ_The_King', seed: 5, score: 5 }, winner: 'a' },
          { a: { name: 'Noobish.Styles', handle: 'noobish.styles', seed: 23, score: 10 }, b: { name: 'Stu', handle: 'zl_stu_lz', seed: 11, score: 8 }, winner: 'a' },
        ],
      },
      {
        name: 'Final',
        matches: [
          { a: { name: 'Luis', handle: 'deep.cerebro', seed: 1, score: 14 }, b: { name: 'Noobish.Styles', handle: 'noobish.styles', seed: 23, score: 12 }, winner: 'a' },
        ],
      },
    ],
  },
  {
    number: 6,
    name: '2v2 Cup',
    format: '2v2',
    year: 2011,
    status: 'completed',
    // Team cup. Initial Era (MJ / CK) beat Sicc (x_ant_x / ant_of_uk) in the final.
    // Full 2v2 game logs are embedded in the page JS — team ties pending.
    champion: { name: 'Initial Era' },
    runnerUp: { name: 'Sicc' },
    finalScore: '2–0',
  },
  {
    number: 7,
    name: 'End of Year Double Elimination',
    format: 'D/E',
    year: 2011,
    status: 'completed',
    entrants: 64,
    champion: { name: 'Pita', handle: 'AzN_PrIdE_LuVa' },
    runnerUp: { name: 'MJ', handle: 'MJ_The_King' },
    // 64-player double-elim, organised by MJ (challonge.com/8br). 3rd was au.stralia.
    // Full DE bracket pending — the cup Bracket model is single-elim only.
  },
  {
    number: 8,
    name: 'Prize',
    format: 'Prize',
    year: 2012,
    status: 'completed',
    champion: { name: 'Luis', handle: 'deep.cerebro' },
    // 64-draw with multi-set (tennis-style) scores. Bracket pending — needs set-score parsing.
  },
  {
    number: 9,
    name: '602 Invitational',
    format: 'D/E',
    year: 2026,
    date: '2026-05-18',
    status: 'completed',
    entrants: 29,
    champion: { name: 'Kevin', handle: 'sixohtwo' },
    runnerUp: { name: 'Player' },
    thirdPlace: { name: 'l_Mr_CC_l' },
    // Double-elimination, 29 players, organised by Kevin (THE_PFB). Source: challonge.com/dirp00rf.
    // Runner-up "Player" is an anonymised/deleted Challonge account (unresolved).
    // Grand final shows 0-0 (Kevin won the bracket undefeated; no reset was played).
    winnersBracket: [
      {
        name: 'Round 1',
        matches: [
          { a: { name: 'a.r.s.h', seed: 4, score: 0 }, b: { name: 'Bitch', seed: 5, score: 7 }, winner: 'b' },
          { a: { name: 'fsm_brian', seed: 6, score: 5 }, b: { name: 'JC', seed: 7, score: 7 }, winner: 'b' },
          { a: { name: 'JEFE_122', seed: 8, score: 2 }, b: { name: 'Ghostshot', seed: 9, score: 7 }, winner: 'b' },
          { a: { name: 'Player', seed: 10, score: 7 }, b: { name: 'PFB', seed: 11, score: 0 }, winner: 'a' },
          { a: { name: 'spc_shogun', seed: 12, score: 6 }, b: { name: 'xlx_ogges_xlx', seed: 13, score: 8 }, winner: 'b' },
          { a: { name: 'mrspin', seed: 14, score: 5 }, b: { name: 'Derrick', seed: 15, score: 7 }, winner: 'b' },
          { a: { name: 'l_Mr_CC_l', seed: 16, score: 7 }, b: { name: 'aig', seed: 17, score: 2 }, winner: 'a' },
          { a: { name: 'sixohtwo', seed: 18, score: 7 }, b: { name: 'adambuddy', seed: 19, score: 3 }, winner: 'a' },
          { a: { name: 'NooB', seed: 20, score: 0 }, b: { name: 'legend.skillz', seed: 21, score: 7 }, winner: 'b' },
          { a: { name: 'mrgaz86', seed: 22, score: 7 }, b: { name: 'Jabronni', seed: 23, score: 0 }, winner: 'a' },
          { a: { name: 'Luke', seed: 24, score: 1 }, b: { name: 'lilsparky67', seed: 25, score: 7 }, winner: 'b' },
        ],
      },
      {
        name: 'Round 2',
        matches: [
          { a: { name: 'Faisal', seed: 1, score: 7 }, b: { name: 'Bitch', seed: 5, score: 5 }, winner: 'a' },
          { a: { name: 'JC', seed: 7, score: 5 }, b: { name: 'Ghostshot', seed: 9, score: 7 }, winner: 'b' },
          { a: { name: 'Player', seed: 10, score: 7 }, b: { name: 'xlx_ogges_xlx', seed: 13, score: 4 }, winner: 'a' },
          { a: { name: 'Derrick', seed: 15, score: 7 }, b: { name: 'l_Mr_CC_l', seed: 16, score: 5 }, winner: 'a' },
          { a: { name: 'Easyrun', seed: 2, score: 4 }, b: { name: 'sixohtwo', seed: 18, score: 7 }, winner: 'b' },
          { a: { name: 'legend.skillz', seed: 21, score: 4 }, b: { name: 'mrgaz86', seed: 22, score: 7 }, winner: 'b' },
          { a: { name: 'Black_Jesus', seed: 3, score: 1 }, b: { name: 'lilsparky67', seed: 25, score: 7 }, winner: 'b' },
        ],
      },
      {
        name: 'Round 3',
        matches: [
          { a: { name: 'Faisal', seed: 1, score: 7 }, b: { name: 'Ghostshot', seed: 9, score: 4 }, winner: 'a' },
          { a: { name: 'Player', seed: 10, score: 10 }, b: { name: 'Derrick', seed: 15, score: 8 }, winner: 'a' },
          { a: { name: 'sixohtwo', seed: 18, score: 7 }, b: { name: 'mrgaz86', seed: 22, score: 0 }, winner: 'a' },
          { a: { name: 'lilsparky67', seed: 25, score: 7 }, b: { name: 'neo', seed: 27, score: 0 }, winner: 'a' },
        ],
      },
      {
        name: 'Round 4',
        matches: [
          { a: { name: 'Faisal', seed: 1, score: 4 }, b: { name: 'Player', seed: 10, score: 9 }, winner: 'b' },
          { a: { name: 'sixohtwo', seed: 18, score: 9 }, b: { name: 'lilsparky67', seed: 25, score: 7 }, winner: 'a' },
        ],
      },
      {
        name: 'Winners Final',
        matches: [
          { a: { name: 'Player', seed: 10, score: 5 }, b: { name: 'sixohtwo', seed: 18, score: 9 }, winner: 'b' },
        ],
      },
    ],
    losersBracket: [
      {
        name: 'Losers Round 1',
        matches: [
          { a: { name: 'Sassy_Banker', seed: 26, score: 1 }, b: { name: 'neo', seed: 27, score: 7 }, winner: 'b' },
          { a: { name: 'S_U_K_I_O_O', seed: 28, score: 7 }, b: { name: 'TRICK__D', seed: 29, score: 0 }, winner: 'a' },
          { a: { name: 'fsm_brian', seed: 6, score: 5 }, b: { name: 'JEFE_122', seed: 8, score: 7 }, winner: 'b' },
          { a: { name: 'PFB', seed: 11, score: 0 }, b: { name: 'spc_shogun', seed: 12, score: 7 }, winner: 'b' },
          { a: { name: 'mrspin', seed: 14, score: 7 }, b: { name: 'aig', seed: 17, score: 0 }, winner: 'a' },
          { a: { name: 'NooB', seed: 20, score: 0 }, b: { name: 'Jabronni', seed: 23, score: 7 }, winner: 'b' },
          { a: { name: 'Sassy_Banker', seed: 26, score: 4 }, b: { name: 'TRICK__D', seed: 29, score: 7 }, winner: 'b' },
        ],
      },
      {
        name: 'Losers Round 2',
        matches: [
          { a: { name: 'neo', seed: 27, score: 7 }, b: { name: 'S_U_K_I_O_O', seed: 28, score: 2 }, winner: 'a' },
          { a: { name: 'S_U_K_I_O_O', seed: 28, score: 7 }, b: { name: 'a.r.s.h', seed: 4, score: 1 }, winner: 'a' },
          { a: { name: 'Black_Jesus', seed: 3, score: 5 }, b: { name: 'JEFE_122', seed: 8, score: 7 }, winner: 'b' },
          { a: { name: 'legend.skillz', seed: 21, score: 3 }, b: { name: 'spc_shogun', seed: 12, score: 7 }, winner: 'b' },
          { a: { name: 'Easyrun', seed: 2, score: 6 }, b: { name: 'mrspin', seed: 14, score: 8 }, winner: 'b' },
          { a: { name: 'l_Mr_CC_l', seed: 16, score: 7 }, b: { name: 'adambuddy', seed: 19, score: 4 }, winner: 'a' },
          { a: { name: 'xlx_ogges_xlx', seed: 13, score: 11 }, b: { name: 'Jabronni', seed: 23, score: 9 }, winner: 'a' },
          { a: { name: 'JC', seed: 7, score: 8 }, b: { name: 'Luke', seed: 24, score: 6 }, winner: 'a' },
          { a: { name: 'Bitch', seed: 5, score: 7 }, b: { name: 'TRICK__D', seed: 29, score: 0 }, winner: 'a' },
        ],
      },
      {
        name: 'Losers Round 3',
        matches: [
          { a: { name: 'S_U_K_I_O_O', seed: 28, score: 3 }, b: { name: 'JEFE_122', seed: 8, score: 7 }, winner: 'b' },
          { a: { name: 'spc_shogun', seed: 12, score: 1 }, b: { name: 'mrspin', seed: 14, score: 7 }, winner: 'b' },
          { a: { name: 'l_Mr_CC_l', seed: 16, score: 10 }, b: { name: 'xlx_ogges_xlx', seed: 13, score: 8 }, winner: 'a' },
          { a: { name: 'JC', seed: 7, score: 7 }, b: { name: 'Bitch', seed: 5, score: 2 }, winner: 'a' },
        ],
      },
      {
        name: 'Losers Round 4',
        matches: [
          { a: { name: 'Derrick', seed: 15, score: 7 }, b: { name: 'JEFE_122', seed: 8, score: 3 }, winner: 'a' },
          { a: { name: 'Ghostshot', seed: 9, score: 7 }, b: { name: 'mrspin', seed: 14, score: 9 }, winner: 'b' },
          { a: { name: 'neo', seed: 27, score: 0 }, b: { name: 'l_Mr_CC_l', seed: 16, score: 7 }, winner: 'b' },
          { a: { name: 'mrgaz86', seed: 22, score: 0 }, b: { name: 'JC', seed: 7, score: 7 }, winner: 'b' },
        ],
      },
      {
        name: 'Losers Round 5',
        matches: [
          { a: { name: 'Derrick', seed: 15, score: 6 }, b: { name: 'mrspin', seed: 14, score: 8 }, winner: 'b' },
          { a: { name: 'l_Mr_CC_l', seed: 16, score: 7 }, b: { name: 'JC', seed: 7, score: 3 }, winner: 'a' },
        ],
      },
      {
        name: 'Losers Round 6',
        matches: [
          { a: { name: 'lilsparky67', seed: 25, score: 9 }, b: { name: 'mrspin', seed: 14, score: 6 }, winner: 'a' },
          { a: { name: 'Faisal', seed: 1, score: 6 }, b: { name: 'l_Mr_CC_l', seed: 16, score: 9 }, winner: 'b' },
        ],
      },
      {
        name: 'Losers Round 7',
        matches: [
          { a: { name: 'lilsparky67', seed: 25, score: 7 }, b: { name: 'l_Mr_CC_l', seed: 16, score: 9 }, winner: 'b' },
        ],
      },
      {
        name: 'Losers Round 8',
        matches: [
          { a: { name: 'Player', seed: 10, score: 9 }, b: { name: 'l_Mr_CC_l', seed: 16, score: 7 }, winner: 'a' },
        ],
      },
    ],
    grandFinal: [
      {
        name: 'Grand Final',
        matches: [
          { a: { name: 'sixohtwo', seed: 18, score: 0 }, b: { name: 'Player', seed: 10, score: 0 }, winner: 'a' },
        ],
      },
    ],
  },
  {
    number: 10,
    name: 'The Bankers Cup',
    format: 'DBT8',
    year: 2026,
    status: 'completed',
    entrants: 32,
    // 32-player single-elimination. "Double BT8" is the game (Double Bank-to-8),
    // not the bracket format. Transcribed from the organiser's results bracket.
    // Missy def. Craig 5–4 in the final. Source: score7.io/tournaments/glwgv5uzp9.
    champion: { name: 'Missy' },
    runnerUp: { name: 'Craig' },
    finalScore: '5–4',
    bracket: [
      {
        name: 'Round 1',
        matches: [
          { a: { name: 'The_PFB' }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'W T F' }, b: { name: 'LJ' }, winner: 'b' },
          { a: { name: 'Nakz_' }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Cameron' }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Faisal' }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'XxKotyxX' }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Bricycle' }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Eskimo', score: 3 }, b: { name: 'Craig', score: 5 }, winner: 'b' },
          { a: { name: 'ugur' }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Missy', score: 5 }, b: { name: 'GØĐⱠłKɆ.÷', score: 2 }, winner: 'a' },
          { a: { name: 'james' }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'sixohtwo' }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Starkiller' }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Ogges' }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Travis' }, b: { name: 'Bye' }, winner: 'a' },
          { a: { name: 'Cue', score: 4 }, b: { name: 'HuStLeR', score: 5 }, winner: 'b' },
        ],
      },
      {
        name: 'Round 2',
        matches: [
          { a: { name: 'The_PFB', score: 0 }, b: { name: 'LJ', score: 5 }, winner: 'b' },
          { a: { name: 'Nakz_', score: 0 }, b: { name: 'Cameron', score: 5 }, winner: 'b' },
          { a: { name: 'Faisal', score: 4 }, b: { name: 'XxKotyxX', score: 6 }, winner: 'b' },
          { a: { name: 'Bricycle', score: 3 }, b: { name: 'Craig', score: 5 }, winner: 'b' },
          { a: { name: 'ugur', score: 4 }, b: { name: 'Missy', score: 5 }, winner: 'b' },
          { a: { name: 'james', score: 5 }, b: { name: 'sixohtwo', score: 2 }, winner: 'a' },
          { a: { name: 'Starkiller', score: 5 }, b: { name: 'Ogges', score: 1 }, winner: 'a' },
          { a: { name: 'Travis', score: 5 }, b: { name: 'HuStLeR', score: 2 }, winner: 'a' },
        ],
      },
      {
        name: 'Quarter Finals',
        matches: [
          { a: { name: 'LJ', score: 3 }, b: { name: 'Cameron', score: 5 }, winner: 'b' },
          { a: { name: 'XxKotyxX', score: 3 }, b: { name: 'Craig', score: 5 }, winner: 'b' },
          { a: { name: 'Missy', score: 5 }, b: { name: 'james', score: 1 }, winner: 'a' },
          { a: { name: 'Starkiller', score: 5 }, b: { name: 'Travis', score: 4 }, winner: 'a' },
        ],
      },
      {
        name: 'Semi Finals',
        matches: [
          { a: { name: 'Cameron', score: 3 }, b: { name: 'Craig', score: 5 }, winner: 'b' },
          { a: { name: 'Missy', score: 5 }, b: { name: 'Starkiller', score: 1 }, winner: 'a' },
        ],
      },
      {
        name: 'Final',
        matches: [{ a: { name: 'Craig', score: 4 }, b: { name: 'Missy', score: 5 }, winner: 'b' }],
      },
    ],
  },
  {
    number: 11,
    name: 'The Creampuff Classic',
    format: 'Knockout',
    year: 2026,
    status: 'live',
    currentRound: 'Semi Finals',
    entrants: 32,
    // Transcribed from the score7.io bracket screenshot. Semis in progress:
    // Starkiller (top) and GØĐⱠłKɆ.÷ (bottom) through; two QFs still pending.
    bracket: [
      {
        name: 'Round 1',
        matches: [
          { a: { name: 'W T F', seed: 1 }, b: { name: 'Bye', seed: 2 }, winner: 'a' },
          { a: { name: 'Cam', seed: 3, score: 8 }, b: { name: 'Ogges', seed: 4, score: 10 }, winner: 'b' },
          { a: { name: 'Starkiller', seed: 5 }, b: { name: 'Bye', seed: 6 }, winner: 'a' },
          { a: { name: 'Luke', seed: 7 }, b: { name: 'Bye', seed: 8 }, winner: 'a' },
          { a: { name: 'eskimo', seed: 9 }, b: { name: 'Bye', seed: 10 }, winner: 'a' },
          { a: { name: 'Missy♥', seed: 11, score: 7 }, b: { name: 'HuStLeR', seed: 12, score: 4 }, winner: 'a' },
          { a: { name: 'Faisal', seed: 13 }, b: { name: 'Bye', seed: 14 }, winner: 'a' },
          { a: { name: 'Thomas', seed: 15, score: 5 }, b: { name: 'ugur', seed: 16, score: 7 }, winner: 'b' },
          { a: { name: 'Cue', seed: 17 }, b: { name: 'Bye', seed: 18 }, winner: 'a' },
          { a: { name: 'sixohtwo', seed: 19, score: 7 }, b: { name: 'Xx Koty xX', seed: 20, score: 2 }, winner: 'a' },
          { a: { name: 'Bricycle', seed: 21 }, b: { name: 'Bye', seed: 22 }, winner: 'a' },
          { a: { name: 'Travis', seed: 23, score: 7 }, b: { name: 'James', seed: 24, score: 2 }, winner: 'a' },
          { a: { name: 'Nakz_', seed: 25 }, b: { name: 'Bye', seed: 26 }, winner: 'a' },
          { a: { name: 'LJ', seed: 27, score: 2 }, b: { name: 'xlx_CC_xlx', seed: 28, score: 7 }, winner: 'b' },
          { a: { name: '-NOOB-', seed: 29 }, b: { name: 'Bye', seed: 30 }, winner: 'a' },
          { a: { name: 'GØĐⱠłKɆ.÷', seed: 31, score: 7 }, b: { name: 'banned', seed: 32, score: 0 }, winner: 'a' },
        ],
      },
      {
        name: 'Round 2',
        matches: [
          { a: { name: 'W T F' }, b: { name: 'Ogges' }, winner: 'b', note: 'Walkover' },
          { a: { name: 'Starkiller', score: 7 }, b: { name: 'Luke', score: 3 }, winner: 'a' },
          { a: { name: 'eskimo', score: 3 }, b: { name: 'Missy♥', score: 7 }, winner: 'b' },
          { a: { name: 'Faisal', score: 7 }, b: { name: 'ugur', score: 5 }, winner: 'a' },
          { a: { name: 'Cue', score: 4 }, b: { name: 'sixohtwo', score: 7 }, winner: 'b' },
          { a: { name: 'Bricycle', score: 7 }, b: { name: 'Travis', score: 4 }, winner: 'a' },
          { a: { name: 'Nakz_', score: 1 }, b: { name: 'xlx_CC_xlx', score: 7 }, winner: 'b' },
          { a: { name: '-NOOB-', score: 4 }, b: { name: 'GØĐⱠłKɆ.÷', score: 7 }, winner: 'b' },
        ],
      },
      {
        name: 'Quarter Finals',
        matches: [
          { a: { name: 'Ogges', score: 3 }, b: { name: 'Starkiller', score: 7 }, winner: 'b' },
          { a: { name: 'Missy♥', score: 5 }, b: { name: 'Faisal', score: 7 }, winner: 'b' },
          { a: { name: 'sixohtwo', score: 7 }, b: { name: 'Bricycle', score: 2 }, winner: 'a' },
          { a: { name: 'xlx_CC_xlx', score: 0 }, b: { name: 'GØĐⱠłKɆ.÷', score: 7 }, winner: 'b', note: 'Forfeit' },
        ],
      },
      {
        name: 'Semi Finals',
        matches: [
          { a: { name: 'Starkiller' }, b: { name: 'Faisal' } },
          { a: { name: 'sixohtwo', score: 6 }, b: { name: 'GØĐⱠłKɆ.÷', score: 8 }, winner: 'b' },
        ],
      },
      {
        name: 'Finals',
        matches: [{ a: {}, b: { name: 'GØĐⱠłKɆ.÷' } }],
      },
    ],
  },
]

// PUBLIC identity scrub: Neo's cup appearances render only as "Neo / Starkiller".
// Applied once at load; source data keeps provenance for internal resolution.
function scrubCupSlot(s: { name?: string; handle?: string } | null | undefined) {
  if (!s || !s.name) return
  const p = scrubForPublic(s.handle, s.name)
  s.name = p.name
  if (p.handle !== undefined) s.handle = p.handle
  else delete s.handle
}
for (const c of CUPS) {
  scrubCupSlot(c.champion)
  scrubCupSlot(c.runnerUp)
  scrubCupSlot(c.thirdPlace)
  const rounds = [
    ...(c.bracket ?? []),
    ...(c.winnersBracket ?? []),
    ...(c.losersBracket ?? []),
    ...(c.grandFinal ?? []),
  ]
  for (const r of rounds) for (const m of r.matches) { scrubCupSlot(m.a); scrubCupSlot(m.b) }
  for (const t of c.teamTies ?? [])
    for (const m of t.matches) { scrubCupSlot(m.home); scrubCupSlot(m.away) }
}

export function getCups(): Cup[] {
  return CUPS
}

export function getCup(number: number): Cup | undefined {
  return CUPS.find((c) => c.number === number)
}

function roundName(matchesInRound: number): string {
  if (matchesInRound === 1) return 'Final'
  if (matchesInRound === 2) return 'Semifinals'
  if (matchesInRound === 4) return 'Quarterfinals'
  return `Round of ${matchesInRound * 2}`
}

/**
 * An empty single-elim bracket shell sized to `entrants` (rounded up to the next
 * power of two). Used to render the template when real results aren't in yet.
 */
export function emptyBracket(entrants: number): BracketRound[] {
  let size = 2
  while (size < entrants) size *= 2
  const rounds: BracketRound[] = []
  for (let m = size / 2; m >= 1; m = m / 2) {
    rounds.push({ name: roundName(m), matches: Array.from({ length: m }, () => ({}) as BracketMatch) })
  }
  return rounds
}

/** The bracket to render for a cup: real data if present, else a sized shell. */
export function cupBracket(cup: Cup): BracketRound[] | null {
  if (cup.bracket && cup.bracket.length) return cup.bracket
  if (cup.entrants && cup.entrants >= 2) return emptyBracket(cup.entrants)
  return null
}
