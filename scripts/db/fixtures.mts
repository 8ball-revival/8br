/**
 * Deterministic dummy data for the development database.
 *
 * ── The rule this file exists to serve ──────────────────────────────────────────────────────────
 * Development never touches real competition data again. Production is the sole authority for that,
 * and it is never restored, cloned or seeded over. So development needs a world of its own:
 * obviously invented, and rich enough that nothing has to be tried "on the real thing".
 *
 * ── Obviously fictional, on purpose ─────────────────────────────────────────────────────────────
 * Every handle carries a DEV_ prefix and every address is on `example.test`, a reserved TLD that can
 * never resolve or receive mail. If one of these ever appears in a screenshot, nobody has to work
 * out whether it was a real member.
 *
 * ── Deterministic ───────────────────────────────────────────────────────────────────────────────
 * No randomness and no clock. Results and orderings come from a hash of fixed strings, and dates are
 * offsets from a frozen base, so two resets produce the same database and yesterday's screenshot
 * still matches today's page.
 *
 * ── What it covers ──────────────────────────────────────────────────────────────────────────────
 * The states nobody remembers to test: seasons with nothing in them, seasons mid-group, private
 * seasons, forfeits, draws, no-contests, byes, a bracket large enough to overflow its container,
 * names long enough to wrap, punctuation and emoji, and a post with no comments beside one with a
 * threaded argument.
 */
import { prisma } from '../../src/lib/prisma.ts'

/** Frozen, so results and "N days ago" copy never drift between resets. */
export const BASE_DATE = new Date('2026-03-01T12:00:00.000Z')
export const day = (n: number) => new Date(BASE_DATE.getTime() + n * 86_400_000)

/** Deterministic pseudo-randomness from a string — there is no Math.random in this file. */
export function hashUnit(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

export const DEV_PASSWORD = 'DevPassw0rd!'

/**
 * One account per permission level.
 *
 * The fifth case, anonymous, needs no row — signed out is a state to test, not an account to create,
 * which is exactly why it is easy to forget.
 */
export const DEV_ACCOUNTS = [
  { key: 'owner', email: 'owner@example.test', username: 'DEV_Owner', name: 'Ottoline Owner', role: 'owner', headAdmin: true, trusted: true },
  { key: 'admin', email: 'admin@example.test', username: 'DEV_Admin', name: 'Adrian Admin', role: 'admin', headAdmin: false, trusted: true },
  { key: 'author', email: 'author@example.test', username: 'DEV_TrustedPen', name: 'Tamsin Trusted', role: 'member', headAdmin: false, trusted: true },
  { key: 'member', email: 'member@example.test', username: 'DEV_Member', name: 'Marcus Member', role: 'member', headAdmin: false, trusted: false },
  { key: 'member2', email: 'member2@example.test', username: 'DEV_SecondMember', name: 'Mira Member-Adjacent', role: 'member', headAdmin: false, trusted: false },
  // Runs the site rather than competing, so Member Management has something to exclude.
  { key: 'ops', email: 'ops@example.test', username: 'DEV_Operations', name: 'DEV Site Operations', role: 'admin', headAdmin: false, trusted: false },
] as const

/**
 * The competitor pool, deliberately awkward in places.
 *
 * A name long enough to wrap a table cell, punctuation and casing that alias normalisation has to
 * survive, and emoji — because a display name is user input, and the layout should not depend on it
 * being tidy.
 */
export const DEV_PLAYERS = [
  { handle: 'DEV_Chalkstripe', name: 'Chalkstripe Charlie', rating: 1820 },
  { handle: 'DEV_BaizeBaron', name: 'Beatrix "The Baize Baron" Odaka-Whitcombe', rating: 1744 },
  { handle: 'DEV_Sidespin', name: 'Sidespin Sam', rating: 1691 },
  { handle: 'DEV_DoubleKiss', name: 'Double-Kiss Dominique', rating: 1655 },
  { handle: 'DEV_PocketPirate', name: 'Pocket Pirate \u{1F3F4}', rating: 1602 },
  { handle: 'DEV_RailRunner', name: 'Rail Runner', rating: 1571 },
  { handle: 'DEV_SnookerToo', name: "O'Malley-Featherstonehaugh, Persephone", rating: 1530 },
  { handle: 'DEV_CueBallKid', name: 'Cue-Ball Kid', rating: 1498 },
  { handle: 'DEV_BankShotBetty', name: 'Bank-Shot Betty', rating: 1466 },
  { handle: 'DEV_MassePhantom', name: 'Massé Phantom ✨', rating: 1433 },
  { handle: 'DEV_ScratchArtist', name: 'Scratch Artist', rating: 1399 },
  { handle: 'DEV_TableRunner', name: 'Table Runner', rating: 1361 },
  { handle: 'DEV_ClusterBuster', name: 'Cluster Buster', rating: 1330 },
  { handle: 'DEV_SafetyFirst', name: 'Safety First', rating: 1288 },
  { handle: 'DEV_TheApprentice', name: 'The Apprentice', rating: 1240 },
  { handle: 'DEV_Newcomer', name: 'Newcomer Nell', rating: 1200 },
] as const

/**
 * Former handles, stored the way the alias fix requires: a normalised key for matching and the
 * spelling for display. The last one has no spelling at all, which is the shape of every alias
 * written before that column existed.
 */
export const DEV_ALIASES: { handle: string; key: string; display: string }[] = [
  { handle: 'DEV_Chalkstripe', key: 'devchalkymki', display: 'DEV_Chalky_MkI' },
  { handle: 'DEV_Chalkstripe', key: 'devcstripe', display: 'DEV.C.Stripe' },
  { handle: 'DEV_BaizeBaron', key: 'devbaronessb', display: 'DEV_Baroness_B' },
  { handle: 'DEV_Sidespin', key: 'devspinnersam', display: 'DEV_Spinner-Sam' },
  { handle: 'DEV_CueBallKid', key: 'devwhiteball', display: '' },
]

export interface SeedContext {
  log: (message: string) => void
}

/**
 * The global settings rows the application reads.
 *
 * Registration is PRIVATE with a code, because the interesting case is the gated one: a public
 * registration form needs no code path exercised, and "what happens with the wrong code" is exactly
 * the thing worth having a fixture for.
 */
export const DEV_SITE_SETTINGS: { key: string; value: string }[] = [
  { key: 'registrationMode', value: 'PRIVATE' },
  { key: 'registrationCode', value: 'dev-code' },
]

/**
 * Remove every row this seed owns.
 *
 * A reseed is a replacement, not an accumulation — otherwise the second run doubles every list and
 * nobody notices until a count looks wrong. Truncating with RESTART IDENTITY also means ids are the
 * same on every reset, which is what makes a bookmarked /seasons/3 keep working.
 */
export async function clearFixtures(ctx: SeedContext): Promise<void> {
  ctx.log('clearing fixture rows')
  await prisma.$executeRawUnsafe(`
    truncate table
      public.rating_ledger, public.season_playoff_match, public.season_match, public.season_standing,
      public.season_group_player, public.season_group, public.season_entrant, public.season,
      public.break_poll_vote, public.break_poll_option, public.break_poll, public.break_comment,
      public.break_post, public.break_category,
      public.comp_tournament_bracket_match, public.comp_tournament_team_member,
      public.comp_tournament_team, public.comp_tournament,
      public.article_comment, public.article, public.article_category,
      public."PlayerAlias", public."Player", public.comp_audit_log,
      public.staff_designation, public.member_moderation, public.achievement_definition,
      public.competition_series
    restart identity cascade`)
}

/** The competition series every fixture season and tournament hangs from. */
async function seedSeries(ctx: SeedContext) {
  ctx.log('competition series')
  await prisma.competitionSeries.createMany({
    data: [
      { id: 1, name: 'DEV Main Tour', slug: 'dev-main-tour', shortName: 'Main' },
      { id: 2, name: 'DEV Invitational', slug: 'dev-invitational', shortName: 'Invite' },
    ],
  })
  await prisma.$executeRawUnsafe(`select setval('competition_series_id_seq', 2, true)`)
}

/** Players, their aliases, and the account links that give five permission levels something to be. */
async function seedPlayers(ctx: SeedContext, userIdByKey: Record<string, number>) {
  ctx.log(`${DEV_PLAYERS.length} players`)
  const accountByHandle: Record<string, string> = {
    DEV_Chalkstripe: 'owner',
    DEV_BaizeBaron: 'admin',
    DEV_Sidespin: 'author',
    DEV_DoubleKiss: 'member',
    DEV_PocketPirate: 'member2',
  }

  for (const p of DEV_PLAYERS) {
    const accountKey = accountByHandle[p.handle]
    const account = DEV_ACCOUNTS.find((a) => a.key === accountKey)
    await prisma.player.create({
      data: {
        id: `dev_${p.handle.toLowerCase()}`,
        primaryName: p.name,
        cueverseId: p.handle,
        cueverseIdNormalized: p.handle.toLowerCase().replace(/[^a-z0-9]/g, ''),
        active: true,
        blogTrustedAuthor: account?.trusted ?? false,
        linkedUserId: account ? String(userIdByKey[account.key]) : null,
        linkStatus: account ? 'VERIFIED' : 'UNLINKED',
      },
    })
  }

  // A management-only profile, so Member Management has something to exclude — the head-admin
  // login runs the site rather than competing, and the roster is supposed to know the difference.
  await prisma.player.create({
    data: {
      id: 'dev_management_only',
      primaryName: 'DEV Site Operations',
      cueverseId: 'DEV_Operations',
      cueverseIdNormalized: 'devoperations',
      managementOnly: true,
      linkedUserId: String(userIdByKey.ops),
      linkStatus: 'VERIFIED',
    },
  })

  ctx.log(`${DEV_ALIASES.length} aliases`)
  for (const a of DEV_ALIASES) {
    await prisma.playerAlias.create({
      data: {
        playerId: `dev_${a.handle.toLowerCase()}`,
        alias: a.key,
        aliasDisplay: a.display || null,
        aliasType: 'HANDLE',
      },
    })
  }
}

const pid = (handle: string) => `dev_${handle.toLowerCase()}`

/**
 * Seasons in every state a season can be in.
 *
 * The finished one carries the interesting results — a forfeit, a draw, a no-contest — because those
 * are the rows that break a standings table, and a season of clean 7-3 wins proves nothing.
 */
async function seedSeasons(ctx: SeedContext) {
  ctx.log('seasons in every lifecycle state')

  const mk = (id: number, o: Partial<Record<string, unknown>> & { number: number; state: string; slug: string }) =>
    prisma.season.create({
      data: {
        id,
        number: o.number,
        competitionYear: 2026,
        competitionSeriesId: 1,
        slug: o.slug,
        lifecycleState: o.state as never,
        platform: ((o.platform as string) ?? 'CUEVERSE') as never,
        publiclyVisible: (o.publiclyVisible as boolean) ?? true,
        division: (o.division as string) ?? 'Division A',
        subtitle: o.subtitle as string,
        description: o.description as string,
        registrationOpensAt: day(-20),
        scheduledStartAt: day(-14),
      },
    })

  // 1 — nothing in it at all. The empty state, which is what a new season looks like on day one.
  await mk(1, { number: 1, state: 'REGISTRATION_SCHEDULED', slug: 'dev-season-1', subtitle: 'Empty — registration not yet open' })

  // 2 — open for registration, with entrants but no groups.
  await mk(2, { number: 2, state: 'REGISTRATION_OPEN', slug: 'dev-season-2', subtitle: 'Taking entries' })

  // 3 — group stage under way: some results in, some still to play.
  await mk(3, { number: 3, state: 'GROUP_STAGE_LIVE', slug: 'dev-season-3', subtitle: 'Groups in progress' })

  // 4 — playoffs live, bracket half-decided. Yahoo-era, so both platforms carry results.
  await mk(4, { number: 4, state: 'PLAYOFFS_LIVE', slug: 'dev-season-4', subtitle: 'Playoffs under way', platform: 'YAHOO' })

  // 5 — finished, with a champion. The one the Rankings are computed from.
  await mk(5, { number: 5, state: 'COMPLETED', slug: 'dev-season-5', subtitle: 'Complete, with a champion', platform: 'YAHOO' })

  // 6 — private and UNFINISHED. Exists, has data, and must 404 for anyone signed out. Registration
  // stage rather than mid-group, because "unfinished work is private" is the rule being tested.
  await mk(6, { number: 6, state: 'REGISTRATION_OPEN', slug: 'dev-season-6', subtitle: 'Private — staff only', publiclyVisible: false })

  // 7 — a completed CueVerse season, so the present era has a champion and a ladder of its own.
  await mk(7, { number: 7, state: 'COMPLETED', slug: 'dev-season-7', subtitle: 'CueVerse era, complete' })

  await prisma.$executeRawUnsafe(`select setval('season_id_seq', 7, true)`)

  // ── Entrants ──────────────────────────────────────────────────────────────────────────────────
  const entrantsFor = async (seasonId: number, players: readonly { handle: string; name: string }[], status = 'APPROVED') => {
    const ids: number[] = []
    for (const [i, p] of players.entries()) {
      const row = await prisma.seasonEntrant.create({
        data: {
          seasonId,
          playerId: pid(p.handle),
          username: p.handle,
          displayName: p.name,
          cueverseId: p.handle,
          status: status as never,
          seed: i + 1,
        },
      })
      ids.push(row.id)
    }
    return ids
  }

  const eight = DEV_PLAYERS.slice(0, 8)
  const twelve = DEV_PLAYERS.slice(0, 12)

  // Season 2: entrants awaiting approval as well as approved, so the staff queue is not empty.
  await entrantsFor(2, DEV_PLAYERS.slice(0, 6))
  await entrantsFor(2, DEV_PLAYERS.slice(6, 9), 'PENDING')

  const s3 = await entrantsFor(3, eight)
  const s4 = await entrantsFor(4, eight)
  const s5 = await entrantsFor(5, twelve)
  const s6 = await entrantsFor(6, DEV_PLAYERS.slice(0, 4))
  const s7 = await entrantsFor(7, eight)

  return { s3, s4, s5, s6, s7, eight, twelve }
}

/**
 * Groups, matches and standings.
 *
 * Season 3 is left half-played on purpose: a table with empty cells is the state a live season
 * actually spends most of its life in. Season 5 is complete, and carries the awkward results — a
 * forfeit, a draw and a no-contest — because those are what a standings calculation gets wrong.
 */
async function seedGroupStage(
  ctx: SeedContext,
  seasonId: number,
  entrantIds: number[],
  players: readonly { handle: string }[],
  opts: { complete: boolean; awkward?: boolean },
) {
  ctx.log(`season ${seasonId}: groups`)
  const perGroup = Math.ceil(entrantIds.length / 2)
  const groups: { id: number; members: number[]; codes: string[] }[] = []

  for (const [gi, code] of ['A', 'B'].entries()) {
    const group = await prisma.seasonGroup.create({
      data: { seasonId, code, name: `Group ${code}`, ordinal: gi + 1, published: true },
    })
    const members = entrantIds.slice(gi * perGroup, (gi + 1) * perGroup)
    for (const [i, entrantId] of members.entries()) {
      await prisma.seasonGroupPlayer.create({ data: { groupId: group.id, entrantId, seed: i + 1 } })
    }
    groups.push({ id: group.id, members, codes: members.map((_, i) => players[gi * perGroup + i].handle) })
  }

  const ledger: {
    matchKey: string; playerId: string; playerName: string; opponentName: string
    result: string; actual: number; seasonId: number; completedAt: Date
  }[] = []

  for (const g of groups) {
    // Round robin, and a standings row per member built from the results as they are written.
    const tally = new Map<number, { w: number; l: number; d: number; gf: number; ga: number }>()
    for (const m of g.members) tally.set(m, { w: 0, l: 0, d: 0, gf: 0, ga: 0 })

    let round = 0
    for (let i = 0; i < g.members.length; i++) {
      for (let j = i + 1; j < g.members.length; j++) {
        round++
        const home = g.members[i]
        const away = g.members[j]
        const homeName = g.codes[i]
        const awayName = g.codes[j]
        const key = `${seasonId}:${home}:${away}`
        const roll = hashUnit(key)

        // Half of a live season's fixtures have not happened yet.
        if (!opts.complete && roll > 0.55) {
          await prisma.seasonMatch.create({
            data: { seasonId, groupId: g.id, round, homeEntrantId: home, awayEntrantId: away, homeUsername: homeName, awayUsername: awayName, status: 'SCHEDULED' },
          })
          continue
        }

        // The awkward cases, placed deterministically rather than sprinkled.
        const awkward = opts.awkward
          ? roll < 0.08 ? 'FORFEIT' : roll < 0.16 ? 'DRAW' : roll < 0.2 ? 'NO_CONTEST' : 'NORMAL'
          : 'NORMAL'

        const homeGames = awkward === 'DRAW' ? 5 : awkward === 'FORFEIT' ? 0 : roll < 0.5 ? 7 : 3 + Math.floor(roll * 4)
        const awayGames = awkward === 'DRAW' ? 5 : awkward === 'FORFEIT' ? 7 : homeGames === 7 ? Math.floor(roll * 7) : 7

        const status = awkward === 'NO_CONTEST' ? 'NO_CONTEST' : awkward === 'FORFEIT' ? 'FORFEIT' : 'COMPLETED'
        const isDraw = awkward === 'DRAW'
        const homeWon = !isDraw && homeGames > awayGames

        await prisma.seasonMatch.create({
          data: {
            seasonId, groupId: g.id, round,
            homeEntrantId: home, awayEntrantId: away,
            homeUsername: homeName, awayUsername: awayName,
            status: status as never,
            homeGames: status === 'NO_CONTEST' ? null : homeGames,
            awayGames: status === 'NO_CONTEST' ? null : awayGames,
            winnerEntrantId: status === 'NO_CONTEST' || isDraw ? null : homeWon ? home : away,
            loserEntrantId: status === 'NO_CONTEST' || isDraw ? null : homeWon ? away : home,
            forfeitEntrantId: awkward === 'FORFEIT' ? home : null,
            note: awkward === 'NO_CONTEST' ? 'DEV fixture: recorded as a no-contest' : null,
            completedAt: status === 'NO_CONTEST' ? null : day(-10 + round),
          },
        })

        if (status === 'NO_CONTEST') continue

        const ht = tally.get(home)!
        const at = tally.get(away)!
        ht.gf += homeGames; ht.ga += awayGames
        at.gf += awayGames; at.ga += homeGames
        if (isDraw) { ht.d++; at.d++ } else if (homeWon) { ht.w++; at.l++ } else { ht.l++; at.w++ }

        // The ledger the Rankings are built from — only for a season that has finished.
        if (opts.complete) {
          const at0 = day(-10 + round)
          ledger.push(
            { matchKey: `group:${key}`, playerId: pid(homeName), playerName: homeName, opponentName: awayName, result: isDraw ? 'DRAW' : homeWon ? 'WIN' : 'LOSS', actual: isDraw ? 0.5 : homeWon ? 1 : 0, seasonId, completedAt: at0 },
            { matchKey: `group:${key}`, playerId: pid(awayName), playerName: awayName, opponentName: homeName, result: isDraw ? 'DRAW' : homeWon ? 'LOSS' : 'WIN', actual: isDraw ? 0.5 : homeWon ? 0 : 1, seasonId, completedAt: at0 },
          )
        }
      }
    }

    const ranked = [...tally.entries()]
      .map(([entrantId, t]) => ({ entrantId, ...t, points: t.w * 3 + t.d }))
      .sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga))

    for (const [i, r] of ranked.entries()) {
      const idx = g.members.indexOf(r.entrantId)
      await prisma.seasonStanding.create({
        data: {
          seasonId, groupId: g.id, entrantId: r.entrantId, username: g.codes[idx],
          played: r.w + r.l + r.d, wins: r.w, losses: r.l, draws: r.d,
          gamesWon: r.gf, gamesLost: r.ga, points: r.points, rank: i + 1,
          qualified: opts.complete && i < 2,
        },
      })
    }
  }

  return ledger
}

/**
 * Playoff brackets, including one with a bye and one big enough to overflow.
 *
 * A bye is not a match nobody played — it is a slot with one name in it, and a bracket that renders
 * it as an empty box beside a real player is the bug this fixture exists to expose.
 */
async function seedPlayoffs(ctx: SeedContext, seasonId: number, entrantIds: number[], players: readonly { handle: string }[], complete: boolean) {
  ctx.log(`season ${seasonId}: playoffs`)
  const qualified = entrantIds.slice(0, complete ? 8 : 4)
  const names = players.slice(0, qualified.length).map((p) => p.handle)

  // Round 1
  const round1: { home: number | null; away: number | null; winner: number | null }[] = []
  for (let i = 0; i < qualified.length / 2; i++) {
    const home = qualified[i]
    const away = qualified[qualified.length - 1 - i]
    // The last slot of the completed bracket is a bye: one name, no opponent.
    const isBye = complete && i === qualified.length / 2 - 1
    round1.push({ home, away: isBye ? null : away, winner: isBye ? home : hashUnit(`${seasonId}:po:${i}`) < 0.5 ? home : away })
  }

  for (const [slot, m] of round1.entries()) {
    const homeIdx = qualified.indexOf(m.home!)
    const awayIdx = m.away == null ? -1 : qualified.indexOf(m.away)
    await prisma.seasonPlayoffMatch.create({
      data: {
        seasonId, round: 1, slot: slot + 1,
        label: m.away == null ? 'Bye' : `Quarter-final ${slot + 1}`,
        homeEntrantId: m.home, awayEntrantId: m.away,
        homeUsername: names[homeIdx], awayUsername: awayIdx >= 0 ? names[awayIdx] : null,
        homeSeed: homeIdx + 1, awaySeed: awayIdx >= 0 ? awayIdx + 1 : null,
        homeGames: m.away == null ? null : m.winner === m.home ? 9 : 4,
        awayGames: m.away == null ? null : m.winner === m.home ? 4 : 9,
        winnerEntrantId: m.winner,
        status: (m.away == null ? 'COMPLETED' : 'COMPLETED') as never,
        completedAt: day(-4),
      },
    })
  }

  // Round 2 — played only in the finished season; left open in the live one, which is the point.
  const winners = round1.map((m) => m.winner!)
  for (let i = 0; i < winners.length / 2; i++) {
    const home = winners[i * 2]
    const away = winners[i * 2 + 1]
    const decided = complete
    await prisma.seasonPlayoffMatch.create({
      data: {
        seasonId, round: 2, slot: i + 1,
        label: winners.length === 2 ? 'Final' : `Semi-final ${i + 1}`,
        homeEntrantId: home, awayEntrantId: away,
        homeUsername: names[qualified.indexOf(home)], awayUsername: names[qualified.indexOf(away)],
        homeGames: decided ? 9 : null, awayGames: decided ? 6 : null,
        winnerEntrantId: decided ? home : null,
        status: (decided ? 'COMPLETED' : 'SCHEDULED') as never,
        completedAt: decided ? day(-2) : null,
      },
    })
  }

  if (complete && winners.length >= 4) {
    const finalists = [winners[0], winners[2]]
    await prisma.seasonPlayoffMatch.create({
      data: {
        seasonId, round: 3, slot: 1, label: 'Final',
        homeEntrantId: finalists[0], awayEntrantId: finalists[1],
        homeUsername: names[qualified.indexOf(finalists[0])], awayUsername: names[qualified.indexOf(finalists[1])],
        homeGames: 9, awayGames: 7, winnerEntrantId: finalists[0],
        status: 'COMPLETED' as never, completedAt: day(-1),
      },
    })
    const champion = names[qualified.indexOf(finalists[0])]
    const runnerUp = names[qualified.indexOf(finalists[1])]
    await prisma.season.update({
      where: { id: seasonId },
      data: {
        championName: champion, championHandle: champion, championPlayerId: pid(champion),
        runnerUpName: runnerUp, runnerUpHandle: runnerUp,
        finalScore: '9-7', completedAt: day(-1),
        // The ranking engine requires this: a Season with no ladderAppliedAt is not eligible, so a
        // rebuild silently produces an empty ledger and every ranked page goes blank.
        ladderAppliedAt: day(-1),
      },
    })
    return { champion, runnerUp }
  }
  return null
}

/** One tournament per supported format, so no format is only ever exercised in production. */
async function seedTournaments(ctx: SeedContext) {
  ctx.log('tournaments in every format')
  const defs = [
    { number: 1, name: 'DEV Singles Knockout', format: 'SINGLE_ELIM', participant: 'INDIVIDUAL', teamSize: null, state: 'COMPLETED', run: 'COMPLETED', visible: true, champion: 'DEV_Chalkstripe' },
    { number: 2, name: 'DEV Double-Elimination Cup', format: 'DOUBLE_ELIM', participant: 'INDIVIDUAL', teamSize: null, state: 'COMPLETED', run: 'COMPLETED', visible: true, champion: 'DEV_Sidespin' },
    { number: 3, name: 'DEV Swiss Open', format: 'SWISS', participant: 'INDIVIDUAL', teamSize: null, state: 'IN_PROGRESS', run: 'ACTIVE', visible: true, champion: null },
    { number: 4, name: 'DEV Teams 5v5', format: 'TEAM_KNOCKOUT', participant: 'TEAM', teamSize: 5, state: 'GROUPS_IN_PROGRESS', run: 'ACTIVE', visible: true, champion: null },
    { number: 5, name: 'DEV Round Robin', format: 'ROUND_ROBIN', participant: 'INDIVIDUAL', teamSize: null, state: 'REGISTRATION_OPEN', run: 'UPCOMING', visible: true, champion: null },
    { number: 6, name: 'DEV Groups and Playoffs', format: 'GROUPS_PLAYOFFS', participant: 'INDIVIDUAL', teamSize: null, state: 'DRAFT', run: 'UPCOMING', visible: true, champion: null },
    // Private: exists, and must not appear to anyone signed out.
    { number: 7, name: 'DEV Private Invitational', format: 'SINGLE_ELIM', participant: 'INDIVIDUAL', teamSize: null, state: 'COMPLETED', run: 'COMPLETED', visible: false, champion: 'DEV_BaizeBaron' },
  ]

  for (const d of defs) {
    await prisma.tournament.create({
      data: {
        number: d.number,
        code: `DEVT${String(d.number).padStart(3, '0')}`,
        slug: `dev-tournament-${d.number}`,
        name: d.name,
        competitionYear: 2026,
        competitionSeries: { connect: { id: d.number % 2 === 0 ? 2 : 1 } },
        gameType: '8-Ball',
        participantFormat: d.participant as never,
        teamSize: d.teamSize,
        tournamentFormat: d.format as never,
        lifecycleState: d.state as never,
        status: d.run as never,
        publiclyVisible: d.visible,
        entrantsCount: d.participant === 'TEAM' ? 4 : 8,
        championName: d.champion,
        championHandle: d.champion,
        runnerUpName: d.champion ? 'DEV_RailRunner' : null,
        archivedAt: d.run === 'COMPLETED' ? day(-6) : null,
        ladderAppliedAt: d.run === 'COMPLETED' ? day(-6) : null,
      },
    })
  }
  await prisma.$executeRawUnsafe(`select setval('comp_tournament_id_seq', ${defs.length}, true)`)
}

/**
 * The Break: a feed with something in every state.
 *
 * Including the two easiest to forget — a post nobody has replied to, and a category with no posts
 * at all. An empty state is a design, not an accident, and it needs something to render it.
 */
async function seedTheBreak(ctx: SeedContext) {
  ctx.log('The Break: posts, comments, a poll, and empty states')

  const cats = await Promise.all([
    prisma.breakCategory.create({ data: { name: 'DEV Announcements', slug: 'dev-announcements', description: 'Fixture category', sortOrder: 1 } }),
    prisma.breakCategory.create({ data: { name: 'DEV Match Talk', slug: 'dev-match-talk', description: 'Fixture category', sortOrder: 2 } }),
    // Deliberately left with no posts, so the empty category view has a subject.
    prisma.breakCategory.create({ data: { name: 'DEV Quiet Corner', slug: 'dev-quiet-corner', description: 'Deliberately empty', sortOrder: 3 } }),
  ])

  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

  const posts = [
    { title: 'DEV: Season 5 wraps up', type: 'TEXT', cat: 0, body: 'A fixture post with a couple of replies underneath it.', comments: 3, draft: false },
    { title: 'DEV: Nobody has replied to this one', type: 'TEXT', cat: 1, body: 'Deliberately left without comments, so the empty thread state has something to render.', comments: 0, draft: false },
    { title: 'DEV: Which format should we run next?', type: 'POLL', cat: 1, body: 'Fixture poll.', comments: 1, draft: false },
    { title: 'DEV: A very long title that keeps going well past the point of comfort to prove the feed can wrap a heading without pushing the metadata out of the card', type: 'TEXT', cat: 0, body: 'Long-title fixture.', comments: 0, draft: false },
    { title: 'DEV: Draft, not published', type: 'TEXT', cat: 0, body: 'Only staff and the author should see this.', comments: 0, draft: true },
  ]

  let pollPostId: number | null = null
  for (const [i, p] of posts.entries()) {
    const author = DEV_ACCOUNTS[i % 3]
    const post = await prisma.breakPost.create({
      data: {
        type: p.type as never,
        state: (p.draft ? 'DRAFT' : 'PUBLISHED') as never,
        authorPlayerId: pid(DEV_PLAYERS[i % 3].handle),
        authorNameSnapshot: author.name,
        authorHandleSnapshot: DEV_PLAYERS[i % 3].handle,
        title: p.title,
        slug: `dev-post-${i + 1}`,
        slugKey: `dev-post-${i + 1}`,
        body: doc(p.body) as never,
        bodyText: p.body,
        categoryId: cats[p.cat].id,
        publishedAt: p.draft ? null : day(-8 + i),
        score: 10 - i,
        upvotes: 10 - i,
      },
    })
    if (p.type === 'POLL') pollPostId = post.id

    for (let c = 0; c < p.comments; c++) {
      const cAuthor = DEV_PLAYERS[(i + c + 1) % DEV_PLAYERS.length]
      const parent = await prisma.breakComment.create({
        data: {
          postId: post.id, path: `${c + 1}`, depth: 0,
          authorPlayerId: pid(cAuthor.handle),
          authorNameSnapshot: cAuthor.name, authorHandleSnapshot: cAuthor.handle,
          body: doc(`DEV comment ${c + 1}`) as never, bodyText: `DEV comment ${c + 1}`,
          score: 3 - c, upvotes: 3 - c, createdAt: day(-7 + c),
        },
      })
      // One nested reply, so thread depth is exercised rather than assumed.
      if (c === 0) {
        const r = DEV_PLAYERS[(i + 5) % DEV_PLAYERS.length]
        await prisma.breakComment.create({
          data: {
            postId: post.id, parentId: parent.id, path: `${c + 1}.1`, depth: 1,
            authorPlayerId: pid(r.handle),
            authorNameSnapshot: r.name, authorHandleSnapshot: r.handle,
            body: doc('DEV nested reply') as never, bodyText: 'DEV nested reply',
            score: 1, upvotes: 1, createdAt: day(-6),
          },
        })
      }
    }
  }

  if (pollPostId != null) {
    const poll = await prisma.breakPoll.create({ data: { postId: pollPostId, closesAt: day(30), totalVotes: 7 } })
    const options = ['Single elimination', 'Double elimination', 'Swiss', 'Round robin']
    const counts = [3, 2, 1, 1]
    for (const [i, text] of options.entries()) {
      await prisma.breakPollOption.create({ data: { pollId: poll.id, position: i, text, voteCount: counts[i] } })
    }
  }
}

/** The two global settings rows, so registration has a mode rather than a missing row. */
async function seedSiteSettings(ctx: SeedContext) {
  ctx.log('site settings')
  for (const setting of DEV_SITE_SETTINGS) {
    await prisma.siteSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    })
  }
}

/** Achievement definitions, so the Achievements page is populated rather than blank. */
async function seedAchievements(ctx: SeedContext) {
  ctx.log('achievement definitions')
  /*
   * Every `statistic` here is a key the registry actually knows (see lib/achievements/statistics).
   * An invented one is accepted by the column and then fails at compute time, which is the sort of
   * fixture that passes its own seed and breaks the page it was meant to exercise.
   *
   * Both award types are represented, because MANUAL and AUTOMATIC take different paths.
   */
  const defs = [
    { key: 'dev_most_wins', title: 'DEV Most Wins', statistic: 'wins', displayFormat: '{value} wins', awardType: 'AUTOMATIC' },
    { key: 'dev_highest_rating', title: 'DEV Highest Rating', statistic: 'rating', displayFormat: '{value}', awardType: 'AUTOMATIC' },
    { key: 'dev_most_titles', title: 'DEV Most Titles', statistic: 'totalTitles', displayFormat: '{value} titles', awardType: 'AUTOMATIC' },
    { key: 'dev_best_win_rate', title: 'DEV Best Win Rate', statistic: 'winPct', displayFormat: '{value}%', awardType: 'AUTOMATIC' },
    { key: 'dev_longest_streak', title: 'DEV Longest Win Streak', statistic: 'longestWinStreak', displayFormat: '{value} in a row', awardType: 'AUTOMATIC' },
    { key: 'dev_committee_choice', title: 'DEV Committee Choice', statistic: null, displayFormat: '{value}', awardType: 'MANUAL' },
  ]
  for (const [i, d] of defs.entries()) {
    await prisma.achievementDefinition.create({
      data: {
        key: d.key, title: d.title, statistic: d.statistic, displayFormat: d.displayFormat,
        awardType: d.awardType as never, sortOrder: i, flavorText: 'Fixture achievement.',
      },
    })
  }
}

/**
 * The rating ledger, built by the application's own engine.
 *
 * This used to be a hand-rolled Elo replay writing rows directly, and it was wrong in a way that
 * only showed up later: the rows looked right, but they were not what `rebuildRatingLedger` would
 * produce. The moment any suite triggered a rebuild — and several do, because eligibility changes
 * are supposed to rebuild — the fixture ledger was replaced by an empty one and every ranked page
 * went blank, which read as broken code rather than a fixture that had never agreed with the engine.
 *
 * Calling the real engine means the fixture ledger is by definition what the site would compute, and
 * a rebuild is a no-op rather than a demolition.
 */
async function seedRatings(ctx: SeedContext) {
  const { rebuildRatingLedger } = await import('../../src/lib/stats/ledger.ts')
  await prisma.$transaction(async (tx) => rebuildRatingLedger(tx), { timeout: 180_000 })
  const rows = await prisma.ratingLedger.count()
  const byPlatform = await prisma.ratingLedger.groupBy({ by: ['platform'], _count: true })
  ctx.log(`rating ledger: ${rows} rows (${byPlatform.map((p) => `${p.platform}:${p._count}`).join(', ')})`)
}

/**
 * Build the whole fixture world.
 *
 * Callers pass the Payload user ids, because accounts have to be created through Payload's own API
 * for their password hashes to be real — a row written straight into the table cannot be logged in
 * to, which would make the permission fixtures useless.
 */
export async function seedAll(ctx: SeedContext, userIdByKey: Record<string, number>): Promise<void> {
  await clearFixtures(ctx)
  await seedSeries(ctx)
  await seedPlayers(ctx, userIdByKey)

  const { s3, s4, s5, s6, s7, eight, twelve } = await seedSeasons(ctx)

  await seedGroupStage(ctx, 3, s3, eight, { complete: false })
  await seedGroupStage(ctx, 6, s6, DEV_PLAYERS.slice(0, 4), { complete: false })
  await seedGroupStage(ctx, 4, s4, eight, { complete: true })
  await seedGroupStage(ctx, 5, s5, twelve, { complete: true, awkward: true })
  await seedGroupStage(ctx, 7, s7, eight, { complete: true })

  await seedPlayoffs(ctx, 4, s4, eight, false)
  await seedPlayoffs(ctx, 5, s5, twelve, true)
  await seedPlayoffs(ctx, 7, s7, eight, true)

  await seedTournaments(ctx)
  await seedTheBreak(ctx)
  await seedAchievements(ctx)
  await seedSiteSettings(ctx)
  await seedRatings(ctx)

  // Staff designations, so the head-admin distinction is exercised rather than assumed.
  await prisma.staffDesignation.create({ data: { userId: userIdByKey.owner, headAdmin: true } })
  await prisma.staffDesignation.create({ data: { userId: userIdByKey.admin, headAdmin: false } })
}
