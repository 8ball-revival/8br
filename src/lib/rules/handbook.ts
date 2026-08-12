/**
 * World Cue Championships — Official Competition Handbook (structured source).
 *
 * The authoritative rule text lives here as typed data (not invented, transcribed
 * verbatim from the official handbook) and is rendered by
 * `src/components/rules/handbook-view.tsx` on the /rules page. Keeping it structured
 * (sections → subsections → blocks) gives a stable anchor per subsection for deep
 * linking, a generated table of contents, and consistent branded styling without a
 * markdown/MDX dependency.
 */

export type HandbookBlock =
  | { k: 'p'; text: string }
  | { k: 'ul'; items: string[] }
  | { k: 'ol'; title?: string; items: string[] }
  | { k: 'dl'; items: { term: string; def: string }[] }
  | { k: 'example'; text: string }

export interface HandbookSubsection {
  /** e.g. "1.1" — also used to build the anchor id "sec-1-1". */
  number: string
  title: string
  blocks: HandbookBlock[]
}

export interface HandbookSection {
  /** e.g. 1 — anchor id "sec-1". */
  number: number
  title: string
  subsections: HandbookSubsection[]
}

export const HANDBOOK_PREAMBLE =
  'This Handbook governs all official World Cue Championships competitions. Participation in any official event constitutes acceptance of every rule contained in this Handbook. Where a specific event publishes supplementary rules, those rules apply in addition to this Handbook and must be announced before registration opens.'

export const HANDBOOK: HandbookSection[] = [
  {
    number: 1,
    title: 'General Administration and Authority',
    subsections: [
      {
        number: '1.1',
        title: 'Application and Acceptance',
        blocks: [
          {
            k: 'p',
            text: 'This Handbook applies to every player, spectator, moderator, and administrator participating in an official World Cue Championships event.',
          },
          {
            k: 'p',
            text: 'Participation in any official competition constitutes acceptance of this Handbook and of all administrator rulings issued under it. By registering, each competitor agrees to follow these rules, accept administrator rulings, compete honestly and in good faith, record matches as required, and preserve the integrity of the competition.',
          },
        ],
      },
      {
        number: '1.2',
        title: 'Tournament Staff Authority',
        blocks: [
          {
            k: 'p',
            text: 'Tournament staff administer and enforce this Handbook. Their responsibilities include resolving rule disputes, investigating technical issues and misconduct, issuing rulings and penalties, and taking any action reasonably necessary to preserve the integrity, fairness, and successful operation of a competition.',
          },
          {
            k: 'p',
            text: 'Tournament staff may deviate from a published format or procedure only when necessary to preserve the integrity or successful completion of the competition. Any such deviation will be documented and communicated to affected competitors whenever reasonably possible.',
          },
          {
            k: 'p',
            text: 'Authority under this Handbook will not be exercised arbitrarily and should be supported by documented reasoning whenever reasonably possible.',
          },
        ],
      },
      {
        number: '1.3',
        title: 'Administrator Instructions',
        blocks: [
          {
            k: 'p',
            text: 'Players must comply with reasonable instructions issued by tournament staff. A disagreement with a ruling must be raised through the appeals process in Section 12, not during an active match.',
          },
          {
            k: 'p',
            text: 'Refusing to follow an administrator instruction during an active match may result in immediate penalties, including game forfeiture, set forfeiture, or removal from the competition.',
          },
        ],
      },
      {
        number: '1.4',
        title: 'Player Responsibility',
        blocks: [
          {
            k: 'p',
            text: 'Each player is responsible for reading the current Handbook, understanding tournament procedures, following administrator instructions, maintaining required recordings, and meeting published deadlines.',
          },
          { k: 'p', text: 'Failure to read the rules does not exempt a player from them.' },
        ],
      },
    ],
  },
  {
    number: 2,
    title: 'Conduct and Competitive Integrity',
    subsections: [
      {
        number: '2.1',
        title: 'Sportsmanship and Good Faith',
        blocks: [
          {
            k: 'p',
            text: 'Players must compete with honesty, integrity, respect, and good faith at all times. Winning is never an excuse for poor sportsmanship, and losing is never an excuse for abusive behavior.',
          },
          {
            k: 'p',
            text: 'Participants must support the integrity of the competition and must not exploit technical loopholes or ambiguous wording to gain an advantage that is clearly inconsistent with the spirit of these rules. This Handbook cannot anticipate every situation, and participants are expected to resolve disagreements constructively rather than undermine the competition through technicalities.',
          },
        ],
      },
      {
        number: '2.2',
        title: 'Respect Toward Others',
        blocks: [
          {
            k: 'p',
            text: 'Players must treat opponents, spectators, moderators, administrators, and tournament staff with respect. Constructive criticism and disagreement are acceptable; personal attacks, harassment, threats, intimidation, discrimination, hate speech, and repeated disruptive behavior are not.',
          },
          {
            k: 'p',
            text: 'This standard applies across all competition-related communication, including in-game chat, Discord, voice chat, and private messages relating to the tournament.',
          },
        ],
      },
      {
        number: '2.3',
        title: 'Harassment',
        blocks: [
          {
            k: 'p',
            text: 'Harassment of any participant is prohibited, including repeated unwanted communication, targeted abuse, intimidation, discrimination, or conduct intended to make a participant feel unwelcome in the competition.',
          },
        ],
      },
      {
        number: '2.4',
        title: 'Respect for Officials',
        blocks: [
          {
            k: 'p',
            text: 'Tournament staff enforce the published rules. Players may disagree with a ruling but must remain respectful. Arguments, harassment, or repeated attempts to pressure staff after a decision has been made may result in disciplinary action. Appeals must follow Section 12.',
          },
        ],
      },
      {
        number: '2.5',
        title: 'Unsportsmanlike Conduct',
        blocks: [
          { k: 'p', text: 'Unsportsmanlike conduct includes, but is not limited to:' },
          {
            k: 'ul',
            items: [
              'deliberately attempting to distract an opponent;',
              'excessive taunting;',
              'deliberately delaying play;',
              'repeatedly refusing reasonable communication or cooperation with tournament procedures;',
              'attempting to manipulate tournament procedures;',
              'attempting to influence an administrator through harassment or intimidation;',
              'falsely accusing another competitor of cheating without reasonable evidence;',
              'encouraging another player to violate the rules.',
            ],
          },
          {
            k: 'p',
            text: 'Whether conduct rises to the level of unsportsmanlike behavior is determined by tournament staff based on the totality of the circumstances.',
          },
        ],
      },
      {
        number: '2.6',
        title: 'Circumvention Through Alternate Accounts or Third Parties',
        blocks: [
          {
            k: 'p',
            text: 'A player must not attempt to circumvent any conduct rule by using alternate accounts, indirect messages, or third parties. Such conduct is treated the same as if it had occurred directly.',
          },
        ],
      },
      {
        number: '2.7',
        title: 'False Information and Deception',
        blocks: [
          {
            k: 'p',
            text: 'Players may not knowingly provide false or misleading information to tournament staff. Prohibited conduct includes falsifying recordings, editing screenshots, misrepresenting scheduling conversations, providing misleading evidence, and impersonating another competitor.',
          },
          {
            k: 'p',
            text: 'Any attempt to intentionally deceive tournament staff may result in severe penalties.',
          },
        ],
      },
      {
        number: '2.8',
        title: 'Competitive Integrity',
        blocks: [
          {
            k: 'p',
            text: 'Every participant must compete to the best of their ability. The following are prohibited: match fixing; intentionally throwing games or sets; collusion; sharing competitive information during active games; and assisting another player in circumventing tournament rules.',
          },
          {
            k: 'p',
            text: 'Tournament staff may investigate any result that reasonably appears inconsistent with normal competitive play. The burden of proof remains on tournament staff.',
          },
        ],
      },
      {
        number: '2.9',
        title: 'Jurisdiction of Conduct Rules',
        blocks: [
          {
            k: 'p',
            text: 'Participants are responsible for their conduct in official tournament spaces, including official Discord channels, official voice channels, tournament livestream chats, and any other platform designated by tournament staff. Conduct occurring outside official tournament spaces may be considered when it directly affects the competition or the safety of its participants.',
          },
        ],
      },
      {
        number: '2.10',
        title: 'Celebrations and Reactions',
        blocks: [
          {
            k: 'p',
            text: 'Reasonable celebrations and emotional reactions are a natural part of competition, and friendly banter between willing participants is acceptable. Celebrations must not be used to mock, humiliate, provoke, or harass. Tournament staff may intervene when behavior becomes disruptive or abusive.',
          },
        ],
      },
    ],
  },
  {
    number: 3,
    title: 'Eligibility and Registration',
    subsections: [
      {
        number: '3.1',
        title: 'Eligibility',
        blocks: [
          {
            k: 'p',
            text: 'Unless otherwise stated, any player may register for an official competition provided they meet all registration requirements before the registration deadline.',
          },
          {
            k: 'p',
            text: 'Tournament staff may deny entry to players who are currently suspended, have unresolved disciplinary investigations, or have previously been removed for cheating or serious misconduct. Returning players may be placed on probation for one tournament if tournament staff determine additional oversight is appropriate.',
          },
          {
            k: 'p',
            text: 'Tournament staff may refuse or revoke entry when necessary to preserve the integrity, fairness, or operation of the competition. This authority will not be exercised arbitrarily and should be supported by documented reasoning whenever reasonably possible.',
          },
        ],
      },
      {
        number: '3.2',
        title: 'Registration Period',
        blocks: [
          {
            k: 'p',
            text: 'Registration opens and closes on dates announced by tournament staff. Entries submitted after the published deadline may be declined unless tournament staff announce that late registration will be accepted. Tournament staff may close registration early if the maximum number of competitors has been reached.',
          },
        ],
      },
      {
        number: '3.3',
        title: 'Player Information',
        blocks: [
          {
            k: 'p',
            text: 'Each competitor must provide accurate registration information, including at minimum a Discord username, a CueVerse Player ID, and any additional information requested during registration. Providing false or misleading registration information may result in removal from the competition.',
          },
        ],
      },
      {
        number: '3.4',
        title: 'Discord Requirement',
        blocks: [
          {
            k: 'p',
            text: 'Every competitor must maintain a valid Discord account throughout the competition and is responsible for checking Discord regularly, responding to scheduling requests promptly, reading tournament announcements, and monitoring any channels designated for official communication. Failure to read announcements does not exempt a player from any rule or deadline.',
          },
        ],
      },
      {
        number: '3.5',
        title: 'Player Identification',
        blocks: [
          {
            k: 'p',
            text: 'Players must compete using the Player ID submitted during registration. A Player ID may not impersonate another player, contain discriminatory, explicit, or offensive content, promote hate groups, be intentionally misleading, or be intentionally disruptive.',
          },
          {
            k: 'p',
            text: 'Tournament staff may require a player to change their Player ID before participating. A player wishing to change their Player ID during a tournament must update it from the myaccount section.',
          },
        ],
      },
      {
        number: '3.6',
        title: 'One Account Per Competitor',
        blocks: [
          {
            k: 'p',
            text: "Each competitor may register only one account per competition unless otherwise approved by tournament staff. Account sharing is prohibited, and no player may play an official match on another person's account or allow another person to play on their account. Tournament staff may request reasonable verification if account ownership is questioned.",
          },
        ],
      },
      {
        number: '3.7',
        title: 'Shared IP Addresses',
        blocks: [
          {
            k: 'p',
            text: 'Multiple competitors may participate from the same IP address only with prior approval from tournament staff obtained before registration. Failure to disclose a shared IP address may result in disciplinary action. Tournament staff may request additional verification to confirm that each competitor is an independent participant.',
          },
        ],
      },
      {
        number: '3.8',
        title: 'Name Changes During a Competition',
        blocks: [
          {
            k: 'p',
            text: 'A player may not change their identity in a way that creates confusion regarding match results, recordings, or tournament records.',
          },
        ],
      },
      {
        number: '3.9',
        title: 'Minimum Activity',
        blocks: [
          {
            k: 'p',
            text: 'Players who repeatedly register for events but fail to participate may lose priority for future registrations.',
          },
        ],
      },
      {
        number: '3.10',
        title: 'Withdrawal',
        blocks: [
          {
            k: 'p',
            text: 'Players are expected to complete every competition they enter. Withdrawal after a competition begins is strongly discouraged and may not occur without notifying tournament staff. The disposition of withdrawals is governed by Sections 5 and 12.',
          },
        ],
      },
      {
        number: '3.11',
        title: 'Competition-Specific Requirements',
        blocks: [
          {
            k: 'p',
            text: 'An event may impose additional eligibility requirements, such as a camera requirement, invitation-only entry, a ranking requirement, or qualification through a previous event. Such requirements must be announced before registration opens and may not be introduced after competitors have entered.',
          },
        ],
      },
    ],
  },
  {
    number: 4,
    title: 'Competition Format',
    subsections: [
      {
        number: '4.1',
        title: 'Definitions',
        blocks: [
          {
            k: 'dl',
            items: [
              { term: 'Game', def: 'a single completed rack of 8-ball.' },
              {
                term: 'Set',
                def: 'a collection of games played between two competitors that produces an official result.',
              },
              {
                term: 'Match',
                def: 'a scheduled contest between two competitors consisting of one official set.',
              },
              {
                term: 'Race Length',
                def: 'the number of games scheduled for a set, or the number of games required to win, depending on the event format.',
              },
            ],
          },
        ],
      },
      {
        number: '4.2',
        title: 'Match Structure',
        blocks: [
          {
            k: 'p',
            text: 'An official match consists of one set between two competitors. A set consists of individual games played until the scheduled race length is completed, a player wins the required number of games, or the set is otherwise concluded under these rules. Tournament standings, statistics, and records are based on completed sets unless otherwise stated.',
          },
        ],
      },
      {
        number: '4.3',
        title: 'Match Start and Recording',
        blocks: [
          {
            k: 'p',
            text: 'An official match begins when both players have entered the table and the first game is started. From that point, the match is officially underway and the recording requirements in Section 11 apply until the set has concluded.',
          },
        ],
      },
      {
        number: '4.4',
        title: 'Scoring',
        blocks: [
          {
            k: 'p',
            text: 'Every completed game counts toward the final set score, except where otherwise provided in this Handbook (see the Group Stage tiebreaker in Section 4.5). No game may be replayed except as required elsewhere in this Handbook.',
          },
          {
            k: 'example',
            text: 'A 7-3 result awards seven game wins to the winner and three game wins to the opponent.',
          },
        ],
      },
      {
        number: '4.5',
        title: 'Group Stage Format',
        blocks: [
          {
            k: 'p',
            text: 'Unless otherwise announced before registration opens, each Group Stage match is one Best-of-10 set. Every game won counts toward the final score, so a completed set may end with any score from 10-0 to 5-5. A score of 5-5 is recorded as a draw worth one point.',
          },
          {
            k: 'p',
            text: 'If a set reaches 5-5, the two players may agree to play a single deciding tiebreaker game to break the tie. The player who wins that game is recorded as winning the set 6-4, and the deciding game is not logged as an additional game (the set still counts as ten games). A tiebreaker is optional and requires the agreement of both players; if it is not played, the set stands as a 5-5 draw.',
          },
        ],
      },
      {
        number: '4.6',
        title: 'Playoff Format',
        blocks: [
          {
            k: 'p',
            text: 'Playoff matches do not permit drawn results. Each playoff round uses the race length announced before the tournament begins, and race lengths may differ by round. If a scheduled race length does not produce a winner, additional games are played until one player wins the match.',
          },
          {
            k: 'example',
            text: 'Quarterfinals - Race to 7; Semifinals - Race to 9; Finals - Race to 9.',
          },
        ],
      },
      {
        number: '4.7',
        title: 'Published Formats',
        blocks: [
          {
            k: 'p',
            text: 'Tournament staff will publish all race lengths before registration opens whenever reasonably possible. Race lengths may differ between the Group Stage, Playoffs, invitational events, cup competitions, and exhibition matches.',
          },
          {
            k: 'p',
            text: 'Once a tournament begins, race lengths may not be changed unless extraordinary circumstances require it. If a format change becomes necessary, tournament staff will publicly announce the reason before the change takes effect.',
          },
        ],
      },
      {
        number: '4.8',
        title: 'Event Variations',
        blocks: [
          {
            k: 'p',
            text: 'A competition may use an alternative format, including single elimination, double elimination, Swiss, round robin, or a group stage followed by playoffs. Any event-specific rules supplement this Handbook and must be published before registration opens.',
          },
        ],
      },
      {
        number: '4.9',
        title: 'Reporting Results',
        blocks: [
          {
            k: 'p',
            text: 'The winner is responsible for reporting the final score unless tournament procedures specify otherwise. Both players remain responsible for ensuring the reported result is accurate. If the players report conflicting scores, tournament staff may request recordings before confirming the official result.',
          },
        ],
      },
      {
        number: '4.10',
        title: 'Match Completion',
        blocks: [
          {
            k: 'p',
            text: 'A match becomes official once the final game has concluded, the result has been reported, and neither player has a valid rules dispute affecting the outcome. Administrative review may still alter an official result if evidence later establishes that a rule violation occurred.',
          },
        ],
      },
      {
        number: '4.11',
        title: 'Incomplete Sets',
        blocks: [
          {
            k: 'p',
            text: 'If a set cannot be completed because of forfeiture, disqualification, withdrawal, or administrative ruling, the official result is determined under Section 12.',
          },
        ],
      },
      {
        number: '4.12',
        title: 'Suspended Sets',
        blocks: [
          {
            k: 'p',
            text: 'If both competitors agree before leaving the table, an unfinished set may continue at a later date. Unless tournament staff approve otherwise, the set resumes with the existing score, with the original breaker sequence preserved whenever reasonably possible, and under the same tournament rules.',
          },
          {
            k: 'p',
            text: 'A suspended set remains an official match. Neither player may restart the completed portion of the set unless tournament staff order otherwise.',
          },
        ],
      },
    ],
  },
  {
    number: 5,
    title: 'Group Stage',
    subsections: [
      {
        number: '5.1',
        title: 'Group Assignment',
        blocks: [
          {
            k: 'p',
            text: 'Players are assigned to groups before the tournament begins. The number of groups, the number of players per group, and the total number of qualifying positions are announced before the competition begins.',
          },
          {
            k: 'p',
            text: 'Once published, group assignments will not change except under extraordinary circumstances approved by tournament staff. If a player withdraws before playing any official set, tournament staff may rebalance groups to preserve competitive fairness.',
          },
        ],
      },
      {
        number: '5.2',
        title: 'Round-Robin Format',
        blocks: [
          {
            k: 'p',
            text: 'Each player plays one scheduled set against every other player in their group. A scheduled opponent may be played only once unless tournament staff order a replay due to an administrative ruling. A completed set counts toward the standings regardless of the margin of victory.',
          },
        ],
      },
      {
        number: '5.3',
        title: 'Standings and Points',
        blocks: [
          {
            k: 'p',
            text: 'Standings are determined using the official point system, which is published before registration opens. Unless otherwise announced before the tournament begins:',
          },
          {
            k: 'dl',
            items: [
              { term: 'Win', def: '3 points' },
              { term: 'Draw', def: '1 point' },
              { term: 'Loss', def: '0 points' },
              {
                term: 'Completion Bonus',
                def: '+1 point for completing every scheduled Group Stage set',
              },
            ],
          },
        ],
      },
      {
        number: '5.4',
        title: 'Completion Bonus',
        blocks: [
          {
            k: 'p',
            text: 'To receive the Completion Bonus, a player must complete every scheduled Group Stage set unless prevented by an administrative ruling. A player who receives an administrative walkover remains eligible for the Completion Bonus provided they fulfilled all scheduling obligations.',
          },
        ],
      },
      {
        number: '5.5',
        title: 'Qualification and Wildcards',
        blocks: [
          {
            k: 'p',
            text: 'The number of qualifying players from each group is announced before the tournament begins. Qualification may be automatic, by wildcard, or by another method announced before registration. No qualification method may be changed after the tournament begins.',
          },
          {
            k: 'p',
            text: 'If wildcard positions are used, the qualification criteria are published before registration opens. Unless otherwise announced, a player must complete at least four scheduled sets to be eligible for a wildcard position. If multiple wildcard candidates remain tied after all published tiebreakers have been applied, tournament staff will announce the final determining method before resolving the tie.',
          },
        ],
      },
      {
        number: '5.6',
        title: 'Tiebreakers',
        blocks: [
          {
            k: 'p',
            text: 'If two or more players finish with the same number of points, ties are broken using the published tiebreakers, applied in order. Tournament staff may not skip a published tiebreaker because another method appears more convenient.',
          },
          {
            k: 'ol',
            title: 'Two-Player Ties',
            items: [
              'Head-to-head result.',
              'Win/loss ratio.',
              'Points earned against higher-placed finishers.',
              'Win/loss ratio against higher-placed finishers.',
              'Any additional tiebreaker announced before the tournament begins, if still required.',
            ],
          },
          {
            k: 'ol',
            title: 'Three-or-More-Player Ties',
            items: [
              'Points earned among the tied players or against higher-placed finishers, whichever format is published before the tournament.',
              'Win/loss ratio.',
              'Win/loss ratio against higher-placed finishers.',
              'Any additional published tiebreaker.',
            ],
          },
        ],
      },
      {
        number: '5.7',
        title: 'Unplayed Sets, Failure to Complete, and Withdrawal',
        blocks: [
          {
            k: 'p',
            text: 'Unplayed sets are resolved under Section 12, and standings reflect those rulings. Scheduling of Group Stage sets is governed by Section 7.',
          },
          {
            k: 'p',
            text: 'Failure to complete scheduled sets may result in loss of the Completion Bonus, administrative forfeits, reduced priority for future events, or other penalties under this Handbook. The outcome depends on the circumstances surrounding the incomplete sets.',
          },
          {
            k: 'p',
            text: 'A player may not voluntarily withdraw after the tournament begins without notifying tournament staff. If a player withdraws, tournament staff determine whether previous results stand, and remaining matches are handled under Section 12. Whenever reasonably possible, tournament staff should replace a withdrawn player with a stand-by player.',
          },
        ],
      },
      {
        number: '5.8',
        title: 'Final Standings',
        blocks: [
          {
            k: 'p',
            text: 'The Group Stage concludes once every scheduled set has been completed or administratively resolved, all standings and tiebreakers have been finalized, and playoff qualification has been confirmed. Once finalized, standings will not change except to correct administrative errors or rule violations discovered after publication.',
          },
        ],
      },
      {
        number: '5.9',
        title: 'Standings Display',
        blocks: [
          {
            k: 'p',
            text: 'Published standings must display at minimum: Matches Played, Wins, Draws, Losses, Games Won, Games Lost, Game Differential, Points, and Completion Bonus status if applicable.',
          },
          {
            k: 'p',
            text: 'Correcting an incorrect published statistic does not constitute an appealable ruling unless the correction changes qualification or seeding.',
          },
        ],
      },
    ],
  },
  {
    number: 6,
    title: 'Playoffs and Seeding',
    subsections: [
      {
        number: '6.1',
        title: 'Qualification',
        blocks: [
          {
            k: 'p',
            text: 'Only players who qualify through the Group Stage, or through another method announced before registration, may participate in the Playoffs. Qualification may be automatic by finishing position, by wildcard, by invitation, or by another published method. No qualification method may be introduced or changed after the competition begins.',
          },
        ],
      },
      {
        number: '6.2',
        title: 'Seeding',
        blocks: [
          {
            k: 'p',
            text: 'Every qualified player receives a playoff seed. Unless otherwise announced before registration, higher seeds are awarded to players who performed better during the Group Stage. The complete seeding procedure is published before the tournament begins, and tournament staff will publish the complete seeding list before the bracket is generated.',
          },
          {
            k: 'ol',
            title: 'Seeds are determined by applying the published criteria in order:',
            items: [
              'Total points.',
              'The official tiebreakers in Section 5.6.',
              'Any additional published criteria announced before the competition begins.',
            ],
          },
          {
            k: 'p',
            text: "Once a higher criterion determines a player's seed, lower criteria are not considered.",
          },
        ],
      },
      {
        number: '6.3',
        title: 'Published Bracket',
        blocks: [
          {
            k: 'p',
            text: 'The playoff bracket is published before the first playoff match begins and remains fixed unless an administrative correction is required. Tournament staff may correct an incorrectly seeded bracket before the first playoff game begins. Once the first playoff game has started, bracket corrections are not permitted.',
          },
        ],
      },
      {
        number: '6.4',
        title: 'Higher-Seed Advantages',
        blocks: [
          {
            k: 'p',
            text: 'Unless otherwise announced before the event, the higher-seeded player creates the table and receives any other advantages specifically announced before registration.',
          },
        ],
      },
      {
        number: '6.5',
        title: 'Race Lengths',
        blocks: [
          {
            k: 'p',
            text: 'Each playoff round uses the published race length announced before registration, and playoff race lengths may differ from Group Stage formats. Playoff format, including the prohibition on drawn results, is described in Section 4.6.',
          },
        ],
      },
      {
        number: '6.6',
        title: 'Bracket Progression',
        blocks: [
          {
            k: 'p',
            text: 'The winner of each playoff match advances to the next round. The losing player is eliminated unless the event uses a double-elimination format.',
          },
        ],
      },
      {
        number: '6.7',
        title: 'Walkovers',
        blocks: [
          {
            k: 'p',
            text: 'If a playoff match cannot be played because a player forfeits, withdraws, or is disqualified, the opposing player advances. Walkovers are not counted as match victories for statistical purposes unless tournament policy states otherwise. Whenever reasonably possible, playoff advancement should occur through play rather than administrative ruling.',
          },
        ],
      },
      {
        number: '6.8',
        title: 'Rescheduling Playoff Matches',
        blocks: [
          {
            k: 'p',
            text: 'Because playoff matches directly affect progression, players must make every reasonable effort to complete them before the published deadline. Tournament staff may schedule a match when players cannot agree, and failure to appear for an administrator-scheduled match may result in forfeiture. Scheduling is otherwise governed by Section 7.',
          },
        ],
      },
      {
        number: '6.9',
        title: 'Championship Match',
        blocks: [
          {
            k: 'p',
            text: 'The Championship Match determines the winner of the competition and follows the same rules as every other playoff match; only the published race length changes. No additional rules may be introduced for the Championship Match after the tournament has begun.',
          },
        ],
      },
      {
        number: '6.10',
        title: 'Third-Place Match',
        blocks: [
          {
            k: 'p',
            text: 'If a third-place match is used, it is announced before registration opens. If no third-place match is scheduled, both losing semifinalists share third place.',
          },
        ],
      },
      {
        number: '6.11',
        title: 'Administrative Corrections and Final Results',
        blocks: [
          {
            k: 'p',
            text: 'Tournament staff may correct playoff results if a rules violation is discovered, an administrative error occurred, or fraudulent evidence affected the outcome. Corrections should occur as soon as reasonably possible.',
          },
          {
            k: 'p',
            text: 'The Playoffs conclude once the Championship Match has been completed, all appeals have been resolved, and the final standings have been published. At that point, the competition is officially complete.',
          },
          {
            k: 'p',
            text: 'Once the Championship Match has concluded and all appeals have been resolved, the published bracket and results become the official historical record of the competition. Subsequent statistical corrections may be made if necessary, but completed championship results will not be altered except in cases of proven administrative error, fraud, or cheating.',
          },
        ],
      },
    ],
  },
  {
    number: 7,
    title: 'Scheduling and Deadlines',
    subsections: [
      {
        number: '7.1',
        title: 'Shared Responsibility',
        blocks: [
          {
            k: 'p',
            text: 'Scheduling is a shared responsibility. Both players are equally responsible for making reasonable efforts to complete their match before the published deadline, and neither player may rely solely on the other to initiate contact.',
          },
        ],
      },
      {
        number: '7.2',
        title: 'Initial Contact',
        blocks: [
          {
            k: 'p',
            text: 'Players should contact their opponent as early as reasonably possible after pairings are published. Tournament staff may consider delayed attempts to initiate scheduling when evaluating a scheduling dispute.',
          },
        ],
      },
      {
        number: '7.3',
        title: 'Reasonable Scheduling Effort',
        blocks: [
          {
            k: 'p',
            text: 'A reasonable scheduling effort includes contacting the opponent through the official communication platform, offering multiple dates or times whenever reasonably possible, responding to scheduling messages within a reasonable time, and remaining willing to negotiate an alternative time if conflicts arise. A single message with no further communication may not constitute a reasonable scheduling effort.',
          },
        ],
      },
      {
        number: '7.4',
        title: 'Communication Platform',
        blocks: [
          {
            k: 'p',
            text: 'Unless otherwise announced, all official scheduling occurs through Discord. A player who schedules through another platform assumes responsibility for preserving evidence if a dispute arises, and tournament staff may give greater weight to scheduling evidence originating from the designated official platform.',
          },
        ],
      },
      {
        number: '7.5',
        title: 'Match Times',
        blocks: [
          {
            k: 'p',
            text: 'Players must agree on a mutually acceptable match time and should confirm the date and approximate start time in writing whenever possible. Once both players have agreed to a match time, both players must honor that agreement.',
          },
        ],
      },
      {
        number: '7.6',
        title: 'Missed Appointments',
        blocks: [
          {
            k: 'p',
            text: 'A player who cannot attend a previously agreed match time must notify their opponent as soon as reasonably possible. Repeated failures to appear without prior notice may result in administrative penalties. A player who repeatedly agrees to match times with no genuine intention of appearing may be considered to have acted in bad faith.',
          },
        ],
      },
      {
        number: '7.7',
        title: 'Player Availability',
        blocks: [
          {
            k: 'p',
            text: 'Players must make reasonable efforts to provide availability throughout the scheduling period. A player whose availability is limited to an unusually narrow window may be expected to demonstrate greater flexibility when resolving scheduling conflicts.',
          },
        ],
      },
      {
        number: '7.8',
        title: 'Good Faith and Avoidant Behavior',
        blocks: [
          {
            k: 'p',
            text: 'All scheduling must be conducted in good faith. Avoiding communication in order to benefit from the deadline is prohibited. Prohibited avoidant behavior includes:',
          },
          {
            k: 'ul',
            items: [
              'repeatedly ignoring messages;',
              'refusing to provide availability;',
              'making scheduling offers known to be impossible;',
              'repeatedly cancelling agreed times without reasonable cause;',
              'intentionally delaying communication until the deadline approaches.',
            ],
          },
          {
            k: 'p',
            text: 'Avoidant behavior may be considered independently of whether the match was ultimately completed.',
          },
        ],
      },
      {
        number: '7.9',
        title: 'Administrator Intervention and Mandatory Match Times',
        blocks: [
          {
            k: 'p',
            text: 'If players cannot reach an agreement, either player may request assistance, and tournament staff may facilitate communication, recommend available times, establish a mandatory match time, or otherwise resolve the dispute. Intervention should occur before the deadline whenever reasonably possible.',
          },
          {
            k: 'p',
            text: 'When tournament staff set a mandatory match time, both players must attend. Failure to appear without prior approval may result in forfeiture, advancement of the opponent, or other administrative action.',
          },
        ],
      },
      {
        number: '7.10',
        title: 'Extensions',
        blocks: [
          {
            k: 'p',
            text: 'Published deadlines are intended to be final. Extensions may be granted only under exceptional circumstances, such as medical emergencies, family emergencies, verified technical failures, or other situations deemed appropriate by tournament staff. Extension requests should be submitted before the deadline whenever reasonably possible.',
          },
        ],
      },
      {
        number: '7.11',
        title: 'Scheduling Evidence',
        blocks: [
          {
            k: 'p',
            text: 'If a scheduling dispute occurs, tournament staff may request Discord messages, screenshots, recordings, timestamps, or other relevant communication. Players are responsible for preserving their own scheduling evidence.',
          },
        ],
      },
      {
        number: '7.12',
        title: 'Failure to Schedule',
        blocks: [
          {
            k: 'p',
            text: 'If a match remains unplayed by the deadline, tournament staff review all available evidence before determining the outcome, which may be an administrative win, an administrative loss, a no contest, an extension, or any other remedy permitted by these rules. The objective is always the fairest outcome supported by the available evidence.',
          },
          {
            k: 'p',
            text: 'When evaluating a scheduling dispute, tournament staff consider factors including which player initiated contact first, the timeliness of responses, the number of reasonable scheduling offers made, the flexibility each player demonstrated, whether administrator assistance was requested before the deadline, whether either player engaged in avoidant behavior, and any extraordinary circumstances supported by evidence. No single factor is decisive; staff evaluate the totality of the evidence.',
          },
        ],
      },
      {
        number: '7.13',
        title: 'Continuous Play of Active Matches',
        blocks: [
          {
            k: 'p',
            text: 'Once both players have entered an official match and the first game has begun, neither player may unreasonably delay completion of the set. Unless both players agree otherwise, a set should be played continuously until completion. If unforeseen circumstances require a pause, Section 8 governs continuation.',
          },
        ],
      },
    ],
  },
  {
    number: 8,
    title: 'Match and Gameplay Rules',
    subsections: [
      {
        number: '8.1',
        title: 'Official Game Mode and Settings',
        blocks: [
          {
            k: 'p',
            text: 'All official matches are played on CueVerse using the game mode and settings specified by tournament staff before the event begins. Only approved settings may be used, and players may not alter match settings without mutual agreement and administrator approval.',
          },
        ],
      },
      {
        number: '8.2',
        title: 'Table Creation and Match Start',
        blocks: [
          {
            k: 'p',
            text: 'The player designated to create the table must ensure the correct game mode, the correct race length, all required tournament settings, and the correct opponent before the match begins. Before the opening break, both players should verify the opponent, the race length, any required recording software, and any other published tournament requirements.',
          },
          {
            k: 'p',
            text: 'Incorrect settings discovered before the first break must be corrected immediately. Once the first game begins, the match is officially underway.',
          },
        ],
      },
      {
        number: '8.3',
        title: 'Standard Gameplay',
        blocks: [
          {
            k: 'p',
            text: "Unless modified by event-specific rules, all games are played according to CueVerse's standard 8-ball mechanics, including legal breaks, legal shots, fouls, scratches, ball-in-hand procedures, and win and loss conditions. Tournament staff will not reinterpret standard game mechanics except to resolve a verified bug or exploit.",
          },
        ],
      },
      {
        number: '8.4',
        title: 'Player Conduct During Games',
        blocks: [
          {
            k: 'p',
            text: 'Players must compete in good faith throughout every game. Intentionally delaying play, distracting an opponent, interfering with gameplay, exploiting known software bugs, or colluding with spectators or third parties during active games is prohibited. General conduct standards are set out in Section 2, and technical situations in Section 9.',
          },
        ],
      },
      {
        number: '8.5',
        title: 'Pauses',
        blocks: [
          {
            k: 'p',
            text: 'Brief pauses may occur for reasonable circumstances, including technical issues, emergency interruptions, administrator requests, or mutual agreement between both players. Players should notify their opponent before leaving the table whenever possible.',
          },
          {
            k: 'p',
            text: 'Repeated unnecessary interruptions intended to disrupt an opponent may be treated as unsportsmanlike conduct.',
          },
        ],
      },
      {
        number: '8.6',
        title: 'Disconnects',
        blocks: [
          {
            k: 'p',
            text: 'If a player disconnects during a match, both players should make reasonable efforts to resume play as soon as possible. Tournament staff may review recordings to determine the appropriate resolution.',
          },
        ],
      },
      {
        number: '8.7',
        title: 'Outside Assistance',
        blocks: [
          {
            k: 'p',
            text: 'During an official match, competitors must make all gameplay decisions independently and may not receive strategic advice, shot recommendations, aiming assistance, coaching, or other competitive assistance from spectators or third parties. This restriction applies until the match has officially concluded. Spectator and commentary conduct is governed by Section 10.',
          },
        ],
      },
    ],
  },
  {
    number: 9,
    title: 'Glitches and Technical Situations',
    subsections: [
      {
        number: '9.1',
        title: 'General Principle',
        blocks: [
          {
            k: 'p',
            text: 'CueVerse may occasionally experience bugs, glitches, or other unexpected behavior. Unless specifically provided otherwise in this Handbook, games continue to be played despite the presence of a bug or glitch, and players are expected to adapt to the circumstances presented by the game rather than pause play or request administrative intervention.',
          },
          {
            k: 'p',
            text: 'By participating in an official competition, players acknowledge that CueVerse may contain bugs, glitches, or other unintended gameplay behavior and accept these conditions as part of competitive play. Except as specifically provided in this Handbook, such occurrences alone do not constitute grounds for replaying a game or overturning a result.',
          },
        ],
      },
      {
        number: '9.2',
        title: 'No Requested Reracks',
        blocks: [
          {
            k: 'p',
            text: 'A player may not request that a game be restarted or reracked because of a bug, glitch, unexpected physics interaction, or other in-game irregularity. The existence of a bug alone is not grounds for replaying a game.',
          },
          {
            k: 'p',
            text: 'Repeatedly requesting reracks because of ordinary gameplay bugs may be considered unsportsmanlike conduct.',
          },
        ],
      },
      {
        number: '9.3',
        title: 'Voluntary Reracks',
        blocks: [
          {
            k: 'p',
            text: 'Only the player who benefits from a bug or glitch may voluntarily offer to rerack the game. The opposing player may accept or decline that offer, and no player is ever obligated to offer or accept a voluntary rerack. Once both players agree to rerack, the original game is treated as void and restarted immediately.',
          },
        ],
      },
      {
        number: '9.4',
        title: 'Administrator Review of Glitches',
        blocks: [
          {
            k: 'p',
            text: 'Tournament staff will not review gameplay disputes involving bugs or glitches except where the game incorrectly awards victory to the wrong player, including where the CueVerse client declares the losing player to be the winner despite the actual outcome of the game. Outside this circumstance, gameplay bugs and glitches are not subject to administrative review.',
          },
        ],
      },
      {
        number: '9.5',
        title: 'Incorrect Match Result',
        blocks: [
          {
            k: 'p',
            text: 'A player who believes CueVerse awarded a game to the incorrect player should preserve their recording, report the issue as soon as reasonably possible, and provide any requested evidence to tournament staff. Tournament staff may review the available evidence to determine whether the official result should be corrected.',
          },
          {
            k: 'p',
            text: 'Such claims should be supported by reliable evidence whenever possible, which may include player recordings, spectator recordings, livestreams, or administrator observations. Tournament staff may decline to alter a result when sufficient evidence is unavailable.',
          },
        ],
      },
      {
        number: '9.6',
        title: 'Significant Bugs',
        blocks: [
          {
            k: 'p',
            text: 'If a significant game bug materially affects play, both players should, if reasonably possible, stop the match, preserve their recordings, notify tournament staff, and await further instructions. This provision does not create a right to a replay or rerack beyond Section 9.4; ordinary bugs do not justify stopping play.',
          },
        ],
      },
      {
        number: '9.7',
        title: 'Exploit Abuse',
        blocks: [
          {
            k: 'p',
            text: 'A player may not intentionally use or reproduce a known game bug, unintended mechanic, or software exploit to gain a competitive advantage. This rule applies regardless of whether the exploit results in an immediate game win. A player who becomes aware that an action may be exploiting the game rather than playing it as intended must discontinue the behavior and notify tournament staff after the match if appropriate.',
          },
          {
            k: 'p',
            text: 'Repeated or deliberate exploit abuse may result in penalties up to and including forfeiture, disqualification, suspension, or permanent removal from future World Cue Championships competitions.',
          },
        ],
      },
      {
        number: '9.8',
        title: 'Server Outages',
        blocks: [
          {
            k: 'p',
            text: 'If CueVerse becomes unavailable because of a verified server outage or widespread technical failure preventing the match from continuing, tournament staff may suspend or reschedule the match. This provision applies only to the availability of the game itself and not to ordinary gameplay bugs.',
          },
        ],
      },
      {
        number: '9.9',
        title: 'Uncovered Situations',
        blocks: [
          {
            k: 'p',
            text: 'Situations not specifically addressed by this section are resolved in a manner consistent with the published rules and principles of World Cue Championships. Tournament staff should avoid creating exceptions that conflict with the principles established in this section.',
          },
        ],
      },
    ],
  },
  {
    number: 10,
    title: 'Spectators and Match Environment',
    subsections: [
      {
        number: '10.1',
        title: 'Spectators',
        blocks: [
          {
            k: 'p',
            text: 'Spectators are welcome to observe official matches unless tournament staff determine that restrictions are necessary. Spectators may not coach players, influence decisions, reveal strategic information, distract competitors, intentionally disrupt a match, or otherwise interfere with the competition. Tournament staff may remove disruptive spectators at any time.',
          },
        ],
      },
      {
        number: '10.2',
        title: 'Coaching and Outside Assistance',
        blocks: [
          {
            k: 'p',
            text: 'During an active match, spectators and third parties may not provide strategic advice, shot suggestions, gameplay recommendations, or any other form of competitive assistance, and competitors may not request or knowingly accept such assistance. This restriction remains in effect until the match has officially concluded. The corresponding duty on players is set out in Section 8.7.',
          },
        ],
      },
      {
        number: '10.3',
        title: 'Responsibility for Guests',
        blocks: [
          {
            k: 'p',
            text: 'Competitors are responsible for any spectators or guests they invite into official match areas, and a competitor may not use spectators as a means of distracting or influencing an opponent. If a guest repeatedly disrupts the competition after being warned, tournament staff may remove that guest and take appropriate action if the competitor encouraged or failed to address the behavior.',
          },
        ],
      },
      {
        number: '10.4',
        title: 'Streaming and Commentary',
        blocks: [
          {
            k: 'p',
            text: 'Unless prohibited by tournament staff or event-specific rules, official matches may be streamed or commented on. Commentators and streamers must maintain a professional standard of conduct and must not intentionally influence active competitors. Commentary may never be used as a method of communicating strategic information to an active player.',
          },
        ],
      },
    ],
  },
  {
    number: 11,
    title: 'Recording and Evidence',
    subsections: [
      {
        number: '11.1',
        title: 'Recording Requirement',
        blocks: [
          {
            k: 'p',
            text: 'Unless tournament staff announce otherwise before the event begins, both competitors must record every official match. Players should verify that their recording software is functioning before the match begins.',
          },
        ],
      },
      {
        number: '11.2',
        title: 'Recording Start and Continuity',
        blocks: [
          {
            k: 'p',
            text: 'Recording should begin before the first game of the match starts and continue until the match has concluded, capturing the entire match without interruption whenever reasonably possible.',
          },
        ],
      },
      {
        number: '11.3',
        title: 'Recording Quality',
        blocks: [
          {
            k: 'p',
            text: 'Recordings should clearly show the game window, player names, mouse movements, and gameplay, and must be a full-screen recording. Video quality should be sufficient to allow tournament staff to reasonably review gameplay if necessary.',
          },
        ],
      },
      {
        number: '11.4',
        title: 'Recording Failures',
        blocks: [
          {
            k: 'p',
            text: "If a recording unexpectedly stops during a match, the player should resume recording as soon as reasonably possible. An unexpected recording failure does not automatically result in penalties, and failure to record a match does not automatically invalidate the result, but either may limit tournament staff's ability to review a dispute. Repeated failures to maintain recordings may be considered when resolving future disputes.",
          },
        ],
      },
      {
        number: '11.5',
        title: 'Retention',
        blocks: [
          {
            k: 'p',
            text: 'Players must retain their recordings for the period announced by tournament staff and should not delete them immediately after a match concludes. Tournament staff may announce different retention periods for specific competitions.',
          },
        ],
      },
      {
        number: '11.6',
        title: 'Submission and Requests',
        blocks: [
          {
            k: 'p',
            text: 'Tournament staff may request recordings for any official match at any time during an active competition, whether or not a dispute has been filed. Requested recordings must be submitted within the timeframe established by tournament staff. Failure to provide a requested recording without reasonable explanation may result in disciplinary action.',
          },
        ],
      },
      {
        number: '11.7',
        title: 'Editing Recordings',
        blocks: [
          {
            k: 'p',
            text: 'Submitted recordings must accurately represent the original match. A player may trim a recording for upload convenience only if no gameplay is removed, no relevant events are omitted, and the recording still accurately reflects the original match. A player may not alter a recording in a manner that misrepresents what occurred.',
          },
        ],
      },
      {
        number: '11.8',
        title: 'Use of Recordings and Evidence',
        blocks: [
          {
            k: 'p',
            text: 'Recordings may be used when reviewing rules disputes, incorrect game results, scheduling disputes, misconduct investigations, or other matters related to tournament administration. Tournament staff may also consider other reliable evidence when appropriate.',
          },
        ],
      },
      {
        number: '11.9',
        title: 'Privacy',
        blocks: [
          {
            k: 'p',
            text: "Recordings submitted to tournament staff are used for tournament administration. Tournament staff may publish recordings with the player's permission, as part of official broadcasts, or when reasonably necessary to explain an administrative ruling. Personal information unrelated to the competition should not be intentionally disclosed when publishing recordings.",
          },
        ],
      },
      {
        number: '11.10',
        title: 'Failure to Record',
        blocks: [
          {
            k: 'p',
            text: 'A player who fails to record a required match automatically loses that match. Repeated failure to comply with recording requirements may result in disciplinary action.',
          },
        ],
      },
      {
        number: '11.11',
        title: 'Official Archive',
        blocks: [
          {
            k: 'p',
            text: 'Once accepted by tournament staff, recordings may become part of the official historical archive of World Cue Championships and may be used for statistics, historical preservation, promotional content, educational material, or official broadcasts.',
          },
        ],
      },
      {
        number: '11.12',
        title: 'Approved Recording Standards',
        blocks: [
          {
            k: 'p',
            text: 'Tournament staff may require competitors to use specific recording software, overlays, or verification methods for certain competitions. Any such requirement is announced before registration opens and applies equally to all competitors in that event.',
          },
        ],
      },
    ],
  },
  {
    number: 12,
    title: 'Disputes, Rulings, and Penalties',
    subsections: [
      {
        number: '12.1',
        title: 'Reporting a Dispute',
        blocks: [
          {
            k: 'p',
            text: 'A player who believes a rule violation has occurred should notify tournament staff as soon as reasonably possible and include any relevant evidence available at the time, such as match recordings, screenshots, Discord messages, tournament logs, or other reliable documentation.',
          },
        ],
      },
      {
        number: '12.2',
        title: 'Burden of Evidence',
        blocks: [
          {
            k: 'p',
            text: 'The player making a claim is responsible for providing sufficient evidence to support that claim whenever reasonably possible. Tournament staff are not required to assume a rule violation occurred without supporting evidence, and if the available evidence is insufficient to establish that a violation occurred, the original result generally stands.',
          },
        ],
      },
      {
        number: '12.3',
        title: 'Investigation and Cooperation',
        blocks: [
          {
            k: 'p',
            text: 'Tournament staff may review any relevant information necessary to resolve a dispute, including match and spectator recordings, official tournament records, Discord conversations, and statements from the involved participants, and may request additional information before issuing a decision.',
          },
          {
            k: 'p',
            text: 'Participants must cooperate with reasonable requests made during an investigation. Refusing to provide requested recordings, knowingly withholding relevant evidence, providing false or misleading information, or intentionally delaying an investigation may be considered when determining the outcome.',
          },
        ],
      },
      {
        number: '12.4',
        title: 'Standard of Review',
        blocks: [
          {
            k: 'p',
            text: 'Tournament staff evaluate disputes based on the available evidence and the published rules. Decisions should be consistent, impartial, supported by evidence, and consistent with previous rulings involving substantially similar circumstances, and should not rest solely on speculation or assumption. If a ruling differs from previous precedent, tournament staff should be prepared to explain the reasons for the difference.',
          },
        ],
      },
      {
        number: '12.5',
        title: 'Forfeits, Walkovers, and Withdrawals',
        blocks: [
          {
            k: 'p',
            text: 'Where a set cannot be completed because of forfeiture, disqualification, withdrawal, or administrative ruling, tournament staff determine the official result based on the available evidence. Possible dispositions include an administrative win, an administrative loss, a walkover advancing the opponent, a no contest, or another remedy permitted by these rules. Scheduling-related failures are additionally governed by Section 7.',
          },
        ],
      },
      {
        number: '12.6',
        title: 'Available Penalties',
        blocks: [
          {
            k: 'p',
            text: 'Depending on the nature and severity of a violation, tournament staff may impose one or more of the following:',
          },
          {
            k: 'ul',
            items: [
              'verbal or written warning;',
              'loss of game;',
              'match forfeiture;',
              'administrative loss;',
              'removal from the current competition;',
              'suspension from future competitions;',
              'permanent ban from World Cue Championships competitions.',
            ],
          },
          {
            k: 'p',
            text: 'Not every violation requires a penalty, and not every penalty is appropriate for every violation.',
          },
        ],
      },
      {
        number: '12.7',
        title: 'Factors Considered',
        blocks: [
          {
            k: 'p',
            text: "When determining an appropriate penalty, tournament staff may consider the severity of the violation, whether the conduct was intentional, whether the violation affected competitive integrity, the participant's cooperation, any previous disciplinary history, and any mitigating or aggravating circumstances. No single factor automatically determines the outcome.",
          },
        ],
      },
      {
        number: '12.8',
        title: 'Guiding Principle',
        blocks: [
          {
            k: 'p',
            text: 'The purpose of disciplinary action is to protect the integrity of the competition, not to punish participants unnecessarily. Whenever reasonably possible, tournament staff should seek the least severe remedy that adequately addresses the violation while maintaining competitive fairness.',
          },
        ],
      },
      {
        number: '12.9',
        title: 'False Reports and Abuse of Process',
        blocks: [
          {
            k: 'p',
            text: 'Knowingly submitting false accusations or fabricated evidence is prohibited. A report made honestly but ultimately determined to be incorrect does not, by itself, constitute a rule violation.',
          },
          {
            k: 'p',
            text: 'The dispute process may not be used to harass other participants, delay tournament progress, retaliate against opponents, or create unnecessary administrative work. Abuse of the dispute process may itself constitute a rule violation.',
          },
        ],
      },
      {
        number: '12.10',
        title: 'Administrative Errors',
        blocks: [
          {
            k: 'p',
            text: 'Tournament staff may correct administrative errors whenever they are discovered, including incorrect standings, incorrect seeding, data-entry mistakes, and published scores that do not match the official result. Corrections made in good faith to address administrative errors are not considered disciplinary action.',
          },
        ],
      },
      {
        number: '12.11',
        title: 'Immediate Action',
        blocks: [
          {
            k: 'p',
            text: 'Tournament staff may take immediate action when necessary to protect the integrity of an active competition, including temporarily removing a participant, suspending a match, delaying publication of results, or preserving evidence pending investigation. Immediate action does not necessarily indicate that a final penalty has been determined.',
          },
        ],
      },
      {
        number: '12.12',
        title: 'Appeals and Final Decisions',
        blocks: [
          {
            k: 'p',
            text: 'Participants may appeal significant tournament decisions. An appeal should clearly identify the ruling being challenged, explain why the participant believes the ruling was incorrect, and include any new or previously unavailable evidence. An appeal is not an opportunity to simply disagree with a decision without presenting a legitimate basis for review.',
          },
          {
            k: 'p',
            text: 'Once an appeal has been reviewed and a final decision has been issued, the matter is considered closed. Participants must respect final decisions and allow the competition to continue. Repeated attempts to relitigate closed matters may be treated as disruptive conduct.',
          },
        ],
      },
    ],
  },
]
