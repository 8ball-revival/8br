/**
 * The redesigned player profile: real records, honest gaps, and a boundary CueVerse cannot cross.
 *
 * ── What this is guarding ───────────────────────────────────────────────────────────────────────
 * The profile is the page most likely to state something the archive cannot support. It shows a
 * career built from twenty years of records of varying completeness, beside a live third-party
 * ladder, and the temptation in every one of those places is to fill a gap with a zero.
 *
 * So the checks below are mostly about what must NOT appear:
 *
 *   · no record for a Season somebody was only rostered in;
 *   · no 0–0 score where the frames were never entered;
 *   · no CueVerse figure inside an 8 Ball Registry figure, in either direction;
 *   · no database id anywhere a person is named.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/verify-player-profile.mts
 */
import { readFileSync, existsSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { getPlayerProfilePage, getProfileIdentity } from '../src/lib/players/profile.ts'
import { searchPlayers } from '../src/lib/players/picker-search.ts'
import { listActivePlayers } from '../src/lib/players/directory.ts'
import { compareMembersByName } from '../src/lib/staff/member-order.ts'
import { decideEditRights } from '../src/lib/players/edit-rights.ts'

assertLocalDatabase()

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/*
  Source with comments stripped.

  These files EXPLAIN what they removed and why, so the words "timezone picker" and "20/50/100"
  appear in their prose. Searching the raw text would fail on the documentation rather than on the
  code, which is the opposite of what the check is for.
*/
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** A player with a long, real career. Found rather than hard-coded, so the suite survives a reseed. */
async function busiestPlayer(): Promise<string> {
  const rows = await prisma.ratingLedger.groupBy({
    by: ['playerId'], _count: { playerId: true },
    orderBy: { _count: { playerId: 'desc' } }, take: 1,
  })
  const p = await prisma.player.findUnique({ where: { id: rows[0].playerId }, select: { cueverseId: true, id: true } })
  return p?.cueverseId ?? p?.id ?? ''
}

const subject = await busiestPlayer()
const profile = await getPlayerProfilePage(subject)
if (!profile) { console.log(`FATAL: no profile for ${subject}`); process.exit(1) }

// ── Identity ────────────────────────────────────────────────────────────────────────────────────
section('The profile is one identity, including anything merged into it')
{
  check('it resolves by CueVerse ID', profile.identity.name.length > 0, subject)
  check('the handle leads', profile.identity.name === (profile.identity.cueverseId ?? profile.identity.name))
  check('the route key is the handle where there is one',
    profile.identity.slug === (profile.identity.cueverseId ?? profile.identity.playerId))

  const byId = await getProfileIdentity(profile.identity.playerId)
  check('the same profile is reachable by player id', byId?.playerId === profile.identity.playerId)

  /*
   * A merged account's history belongs to the identity that absorbed it. If `playerIds` were just
   * the one id, a merged player's Seasons would be missing from their own profile.
   */
  const merges = await prisma.playerMerge.count({ where: { status: 'APPROVED', canonicalPlayerId: profile.identity.playerId } })
  check('merged identities are rolled in',
    profile.identity.playerIds.length === merges + 1,
    `${profile.identity.playerIds.length} ids vs ${merges} merges`)
}

// ── The career figures are sums of matches ──────────────────────────────────────────────────────
section('Every career figure is the sum of recorded matches')
{
  const rows = await prisma.ratingLedger.findMany({
    where: { playerId: { in: profile.identity.playerIds } },
    select: { result: true, stage: true },
  })
  const wins = rows.filter((r) => r.result === 'WIN').length
  const losses = rows.filter((r) => r.result === 'LOSS').length
  const draws = rows.filter((r) => r.result === 'DRAW').length

  check('wins match the ledger', profile.career.record.wins === wins, `${profile.career.record.wins} vs ${wins}`)
  check('losses match the ledger', profile.career.record.losses === losses)
  check('draws match the ledger', profile.career.record.draws === draws)
  check('matches played is the row count', profile.career.matchesPlayed === rows.length)

  const played = wins + losses + draws
  const expected = played === 0 ? 0 : Math.round((wins / played) * 1000) / 10
  check('win % counts draws in the denominator', profile.career.winPct === expected,
    `${profile.career.winPct} vs ${expected}`)

  const group = rows.filter((r) => r.stage !== 'PLAYOFF').length
  const playoff = rows.filter((r) => r.stage === 'PLAYOFF').length
  const g = profile.career.groupRecord, p = profile.career.playoffRecord
  check('the group and playoff splits add back up to the whole',
    (g.wins + g.losses + g.draws) === group && (p.wins + p.losses + p.draws) === playoff)

  // Season and Tournament rows are disjoint in the ledger, so these must partition the matches.
  const perSeason = profile.seasons.reduce((n, s) => n + s.matchesPlayed, 0)
  const perTournament = profile.tournaments.reduce((n, t) => n + t.matchesPlayed, 0)
  check('every match belongs to exactly one competition',
    perSeason + perTournament === rows.length, `${perSeason}+${perTournament} vs ${rows.length}`)
}

// ── The distinction the archive requires ────────────────────────────────────────────────────────
section('Roster-only participation is never given a record')
{
  /*
   * 35 of these exist in the current archive: an entrant row with no ledger rows. A 0–0 record for
   * them would state they played nothing, which the archive does not say.
   */
  const entrants = await prisma.seasonEntrant.findMany({
    where: { NOT: { playerId: null } }, select: { playerId: true, seasonId: true },
  })
  const ledger = await prisma.ratingLedger.findMany({
    where: { NOT: { seasonId: null } }, select: { playerId: true, seasonId: true },
    distinct: ['playerId', 'seasonId'],
  })
  const key = (p: string, s: number) => `${p}:${s}`
  const withMatches = new Set(ledger.map((r) => key(r.playerId, r.seasonId!)))
  const rosterOnly = entrants.filter((e) => !withMatches.has(key(e.playerId!, e.seasonId)))
  check('the archive still contains roster-only entries to test', rosterOnly.length > 0, `${rosterOnly.length}`)

  const victim = rosterOnly[0]
  const p = await prisma.player.findUnique({ where: { id: victim.playerId! }, select: { cueverseId: true, id: true } })
  const page = await getPlayerProfilePage(p?.cueverseId ?? p!.id)
  const season = page?.seasons.find((s) => s.seasonId === victim.seasonId)

  check('their Season is present, not hidden', !!season)
  check('...and is marked roster-only', season?.participation === 'roster-only')
  check('...with NO record', season?.record === null)
  check('...no win percentage', season?.winPct === null)
  check('...no rating change', season?.ratingChange === null)
  check('...no group or playoff record', season?.groupRecord === null && season?.playoffRecord === null)
  check('...and no invented matches', season?.matches.length === 0)
  check('it is counted apart from Seasons actually played',
    (page?.career.seasonsRostered ?? 0) > 0 && !page?.seasons.filter((s) => s.participation === 'verified').some((s) => s.seasonId === victim.seasonId))

  // Every verified Season, by contrast, must carry a record.
  const verified = page?.seasons.filter((s) => s.participation === 'verified') ?? []
  check('a verified Season always has one', verified.every((s) => s.record !== null && s.matchesPlayed > 0))
}

section('A missing score is a dash, never 0–0')
{
  const noFrames = profile.matches.filter((m) => m.score === null)
  const withFrames = profile.matches.filter((m) => m.score !== null && m.score !== 'FF')
  check('scores are absent where frames were not recorded', noFrames.length >= 0, `${noFrames.length} without`)
  check('no match reports a 0–0 result', !profile.matches.some((m) => m.score === '0–0'))
  // A recorded score always reads player-first, so a win never shows the smaller number first.
  const wrongWayRound = withFrames.filter((m) => {
    const [a, b] = (m.score as string).split('–').map(Number)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    return (m.result === 'WIN' && a < b) || (m.result === 'LOSS' && a > b)
  })
  check('a score reads from the player’s own side', wrongWayRound.length === 0, `${wrongWayRound.length} reversed`)

  const seasonsPartial = profile.seasons.filter((s) => s.gamesWon != null && s.matchesWithGameData < s.matchesPlayed)
  check('partial frame data is measured, so the UI can say so',
    seasonsPartial.every((s) => s.matchesWithGameData > 0))
  check('a Season with no frames at all reports null game totals',
    profile.seasons.filter((s) => s.matchesWithGameData === 0).every((s) => s.gamesWon === null))
}

section('Head to head is built from real meetings')
{
  const total = profile.headToHead.reduce((n, r) => n + r.played, 0)
  const soloMatches = profile.matches.filter((m) => !m.isTeamMatch).length
  check('every solo match is counted once', total === soloMatches, `${total} vs ${soloMatches}`)
  check('a team match is not a head to head',
    profile.headToHead.every((r) => r.played > 0))
  check('each row adds up', profile.headToHead.every((r) => r.wins + r.losses + r.draws === r.played))
  check('rows are ordered by how often they met',
    profile.headToHead.every((r, i) => i === 0 || profile.headToHead[i - 1].played >= r.played))
}

section('Achievements are existing records, not new awards')
{
  const before = await prisma.achievement.count()
  await getPlayerProfilePage(subject)
  const after = await prisma.achievement.count()
  // The strongest statement this suite can make about "do not award anything in this task".
  check('reading a profile awards nothing', before === after, `${before} → ${after}`)

  const champ = await prisma.season.findFirst({ where: { NOT: { championPlayerId: null } }, select: { championPlayerId: true, id: true } })
  if (champ?.championPlayerId) {
    const cp = await prisma.player.findUnique({ where: { id: champ.championPlayerId }, select: { cueverseId: true, id: true } })
    const page = await getPlayerProfilePage(cp?.cueverseId ?? cp!.id)
    check('a champion’s title shows on their profile',
      (page?.achievements ?? []).some((a) => a.kind === 'season-title'))
    check('...and their Season is flagged as won',
      (page?.seasons ?? []).some((s) => s.seasonId === champ.id && s.isChampion))
  }

  const nonChamp = profile.seasons.filter((s) => !s.isChampion)
  check('a Season nobody won is not marked Champion',
    nonChamp.every((s) => s.placement !== 'Champion'))
}

// ── Search ──────────────────────────────────────────────────────────────────────────────────────
section('Site-wide search finds people by ID, name and alias')
{
  const p = await prisma.player.findFirst({
    where: { NOT: { cueverseId: null }, managementOnly: false },
    select: { id: true, cueverseId: true, primaryName: true },
  })
  const id = p!.cueverseId as string

  const byWholeId = await searchPlayers(id)
  check('by the full CueVerse ID', byWholeId.some((r) => r.id === p!.id), id)

  // Partial and in the wrong case — how somebody actually types.
  const fragment = id.slice(1, Math.max(3, Math.min(6, id.length))).toUpperCase()
  const byFragment = await searchPlayers(fragment)
  check('by a partial ID, case-insensitively', byFragment.some((r) => r.id === p!.id), `"${fragment}"`)

  if (p!.primaryName && p!.primaryName.length >= 3) {
    const byName = await searchPlayers(p!.primaryName.slice(0, 4).toLowerCase())
    check('by name', byName.some((r) => r.id === p!.id))
  }

  const alias = await prisma.playerAlias.findFirst({ select: { alias: true, playerId: true } })
  if (alias) {
    const byAlias = await searchPlayers(alias.alias)
    check('by a known alias', byAlias.some((r) => r.id === alias.playerId), alias.alias)
  }

  check('a one-character term returns nothing rather than everybody', (await searchPlayers('a')).length === 0)

  /*
   * Results name people. A raw id is not an identity, and putting one in a dropdown is how a person
   * ends up being referred to by a database key on a public page.
   */
  const sample = await searchPlayers(id)
  check('results carry a handle or a name, never only an id',
    sample.every((r) => (r.cueverseId ?? '').length > 0 || (r.name ?? '').length > 0))
}

// ── The boundary ────────────────────────────────────────────────────────────────────────────────
section('CueVerse never reaches an 8 Ball Registry figure')
{
  const registry = readFileSync('src/lib/players/profile.ts', 'utf8')
  check('the profile service does not import the CueVerse client',
    !/from '@\/lib\/cueverse/.test(registry))

  const cueverse = readFileSync('src/lib/cueverse/profile.ts', 'utf8')
  check('the CueVerse adapter does not touch the database', !/@\/lib\/prisma|prisma\./.test(cueverse))
  check('...and does not import a Registry stat', !/@\/lib\/stats/.test(cueverse))

  /*
   * The one that matters most: nothing CueVerse returns is written anywhere. If this fails, the two
   * records have started to merge and a Registry rating is no longer reconstructible from Registry
   * matches alone.
   */
  const writes = /prisma\.\w+\.(create|update|upsert|delete|createMany|updateMany)/
  check('nothing from CueVerse is ever written', !writes.test(cueverse))

  const links = readFileSync('src/lib/cueverse/links.ts', 'utf8')
  check('the profile URL is built from the stored ID, encoded',
    links.includes('encodeURIComponent(id)') && links.includes('/profile/?name='))
  check('the replay URL is CueVerse’s own form', links.includes('/replay/?id='))
}

section('Only the verified owner and player-management staff may edit')
{
  /*
    Exercised directly rather than asserted about. This is the rule that protects every profile on
    the site, so every combination that could plausibly be mistaken for ownership is tried.
  */
  const OWNER = '4037', OTHER = '9999'
  const linked = (status: string, to: string | null = OWNER) => ({ linkedUserId: to, linkStatus: status })

  check('a signed-out visitor is refused',
    decideEditRights({ viewerUserId: null, player: linked('VERIFIED'), staff: false }).ok === false)
  check('...and told to sign in, not that they lack permission',
    (decideEditRights({ viewerUserId: null, player: linked('VERIFIED'), staff: false }) as { error: string }).error
      .includes('Sign in'))

  check('the verified owner may edit',
    decideEditRights({ viewerUserId: OWNER, player: linked('VERIFIED'), staff: false }).ok === true)
  check('...and is recognised as the owner',
    (decideEditRights({ viewerUserId: OWNER, player: linked('VERIFIED'), staff: false }) as { via: string }).via === 'owner')

  // A different signed-in member is the case this exists to stop.
  check('another member may NOT edit somebody else’s profile',
    decideEditRights({ viewerUserId: OTHER, player: linked('VERIFIED'), staff: false }).ok === false)

  /*
    Every link state short of VERIFIED. PENDING is the dangerous one: it is somebody asserting the
    profile is theirs, before anyone has checked. If a claim could grant itself, claiming would be
    the whole attack.
  */
  for (const status of ['PENDING', 'UNLINKED', 'REJECTED', 'REVOKED']) {
    check(`a ${status} link does not confer ownership`,
      decideEditRights({ viewerUserId: OWNER, player: linked(status), staff: false }).ok === false)
  }

  check('a profile linked to nobody confers ownership on nobody',
    decideEditRights({ viewerUserId: OWNER, player: linked('VERIFIED', null), staff: false }).ok === false)
  check('a profile that does not exist cannot be edited',
    decideEditRights({ viewerUserId: OWNER, player: null, staff: false }).ok === false)

  check('staff with player management may edit any profile',
    decideEditRights({ viewerUserId: OTHER, player: linked('VERIFIED'), staff: true }).ok === true)
  check('...and are recognised as staff, not as the owner',
    (decideEditRights({ viewerUserId: OTHER, player: linked('VERIFIED'), staff: true }) as { via: string }).via === 'staff')
  check('staff still need a session',
    decideEditRights({ viewerUserId: null, player: linked('VERIFIED'), staff: true }).ok === false)

  // ── And the server actually applies it ────────────────────────────────────────────────────────
  const actions = readFileSync('src/lib/players/profile-actions.ts', 'utf8')
  check('the mutation re-establishes rights rather than trusting the caller',
    /export async function updateProfileNameAction[\s\S]{0,400}editRights\(playerId\)/.test(actions))
  check('...and refuses before writing anything',
    /const rights = await editRights\(playerId\)\s+if \(!rights\.ok\) return \{ error: rights\.error \}/.test(actions))
  check('the rights check reads the session, not a parameter',
    actions.includes('await getCurrentUser()') && !/updateProfileNameAction\([^)]*userId/.test(actions))
  check('staff access uses the existing player-management capability',
    actions.includes("can('manage_players')"))

  // The button's visibility must not BE the permission.
  /*
    The identity header replaced the sidebar in the framed layout, and it is where Edit Profile now
    lives. What matters is unchanged: the client is handed a boolean the server decided, never a
    capability or a link status it could reason about for itself.
  */
  const header = readFileSync('src/components/players/profile/identity-header.tsx', 'utf8')
  check('the client only receives a flag, never a capability', !/manage_players|linkStatus/.test(header))
  const editor = readFileSync('src/components/players/profile/appearance-editor.tsx', 'utf8')
  check('...and the appearance editor does not decide permission either',
    !/manage_players|linkStatus/.test(editor))
}

section('The profile is one route, and nothing inside it navigates')
{
  const tabs = readFileSync('src/components/players/profile/profile-tabs.tsx', 'utf8')
  check('tabs are buttons, not links', !tabs.includes('next/link') && tabs.includes('role="tab"'))
  check('...and no router is involved', !/useRouter|router\./.test(tabs))
  check('hidden panels stay mounted so state survives a switch', tabs.includes('hidden={!selected}'))

  const expanding = readFileSync('src/components/players/profile/expanding-cards.tsx', 'utf8')
  check('the expansion system does not navigate', !/useRouter|next\/link/.test(expanding))
  check('Escape closes a window', expanding.includes("e.key === 'Escape'"))
  check('reduced motion is honoured, not shortened',
    expanding.includes("'(prefers-reduced-motion: reduce)'") && expanding.includes('reducedMotion()'))
  check('focus moves into the window', expanding.includes('headingRef.current?.focus()'))
  check('...and returns to the control that opened it', expanding.includes('returnTo?.focus()'))
  check('one system serves every card', /cards\.map/.test(expanding))

  const view = readFileSync('src/components/players/profile/profile-view.tsx', 'utf8')
  check('the profile is wrapped in the table frame, not a page of loose cards',
    view.includes('<TableFrame>'))
  for (const key of ['seasons', 'tournaments', 'achievements', 'cueverse']) {
    check(`${key} is a card in that one system`, view.includes(`key: '${key}'`))
  }
  check('the chosen Season survives closing the window', view.includes('const [seasonId, setSeasonId]'))
  check('the chosen Tournament does too', view.includes('const [tournamentId, setTournamentId]'))
}

section('The replay is embedded, one at a time, and unloaded')
{
  const cv = readFileSync('src/components/players/profile/cueverse-window.tsx', 'utf8')
  check('only the selected replay is mounted', /if \(replay\) \{/.test(cv) && cv.includes('key={replay.id}'))
  check('there is one replay state, so there can only be one', (cv.match(/useState<CueverseGame \| null>/g) ?? []).length === 1)
  check('leaving the replay unmounts the iframe', cv.includes('setReplay(null)'))
  check('the iframe is lazy', cv.includes('loading="lazy"'))
  check('the sandbox is the minimum the replay needs',
    cv.includes('sandbox="allow-scripts allow-same-origin"'))
  check('...and withholds forms, popups, downloads and top-level navigation',
    !/allow-forms|allow-popups|allow-downloads|allow-top-navigation/.test(cv))
  check('Back to Game History exists', cv.includes('Back to Game History'))
  check('Open on CueVerse exists', cv.includes('Open on CueVerse'))
  check('the table position is restored on return', cv.includes('savedScroll.current'))
  const body = code(cv)
  check('the removed controls are gone: no timezone picker',
    !/<select|timeZone:/i.test(body))
  check('...and no row-count buttons', !/setLimit|limit=|\bshowLimit\b/i.test(body))
  check('the table scrolls inside itself, with the heading pinned',
    body.includes('overflow-auto') && body.includes('sticky top-0'))
}

section('The Seasons tile is the CueVerse era; View All is the whole career')
{
  /*
    Asked for after the tile read "24 Seasons" on a player whose CueVerse career is one Season. The
    archive runs from 2005 on Yahoo, so a combined figure is swamped by it and says very little
    about a player now. The tile counts CueVerse only; the window behind View All still lists every
    Season and names the platform on each.
  */
  const view = readFileSync('src/components/players/profile/profile-view.tsx', 'utf8')
  check('the tile separates the two eras', /s\.platform !== 'YAHOO'/.test(view))
  check('...and offers a switch between them', /pf-era-btn/.test(view))
  check('...which opens on the era the player actually has',
    /useState<'CUEVERSE' \| 'YAHOO'>\(onCueverse\.length > 0 \? 'CUEVERSE' : 'YAHOO'\)/.test(view))
  check('...and is not drawn when there is nothing to switch to',
    /bothEras \? \(/.test(view) && /const bothEras = onCueverse\.length > 0 && onYahoo\.length > 0/.test(view))
  check('...naming the era instead in that case', /pf-era-label/.test(view))
  check('the window is not filtered — it is the whole career',
    !readFileSync('src/components/players/profile/seasons-window.tsx', 'utf8').includes("platform !== 'YAHOO'"))

  /*
    Titles come from each Season's own championPlayerId.

    The ladder's trophy list returned 0 for every archive champion and carries no Season on an
    entry, so it can be neither trusted nor scoped.
  */
  const mj = await getPlayerProfilePage('MJ_The_King')
  if (mj) {
    const fromSeasons = mj.seasons.filter((s) => s.isChampion).length
    check('a four-time champion is credited with four', mj.career.seasonTitles === 4, String(mj.career.seasonTitles))
    check('...which is what the Season records say', mj.career.seasonTitles === fromSeasons)
    check('...and every one of them is a Yahoo-era Season',
      mj.seasons.filter((s) => s.isChampion).every((s) => s.platform === 'YAHOO'))
    check('...so the CueVerse-scoped tile shows none of them',
      mj.seasons.filter((s) => s.platform !== 'YAHOO' && s.isChampion).length === 0)
  } else {
    console.log('  – MJ_The_King is not in this database')
  }

  const six = await getPlayerProfilePage('sixohtwo')
  if (six) {
    const cueverse = six.seasons.filter((s) => s.platform !== 'YAHOO')
    check('a current player has a CueVerse Season to show', cueverse.length >= 1, String(cueverse.length))
    check('...and the whole career is still there behind it',
      six.seasons.length > cueverse.length, `${six.seasons.length} vs ${cueverse.length}`)
  }
}

section('The Players directory')
{
  /*
    The nav tab that pointed at Achievements now points at a directory of people. Achievements is a
    page about awards — a fine destination, and a strange one to hold a top-level tab while there
    was no way to browse the players the site is about.
  */
  const nav = readFileSync('src/lib/site-builder/globals.ts', 'utf8')
  check('the factory navigation offers Players', /\['Players', '\/players'\]/.test(nav))
  check('...in place of Achievements', !/\['Achievements', '\/achievements'\]/.test(nav))
  const shell = readFileSync('src/components/site-builder/modules/shell.tsx', 'utf8')
  check('...and /players is a destination the site builder will accept',
    /value: '\/players'/.test(shell))
  check('the Achievements route itself is untouched',
    existsSync('src/app/(frontend)/achievements/page.tsx'))

  /* Who belongs in a list of players. */
  const dir = readFileSync('src/lib/players/directory.ts', 'utf8')
  check('withdrawn profiles are left out', /active: true/.test(dir))
  check('...and so is the management-only login', /managementOnly: false/.test(dir))

  const rows = await listActivePlayers()
  check('the directory returns players', rows.length > 0, String(rows.length))
  const inactive = await prisma.player.count({ where: { active: false } })
  const mgmt = await prisma.player.count({ where: { managementOnly: true, active: true } })
  const all = await prisma.player.count()
  check('...exactly the active, non-management ones', rows.length === all - inactive - mgmt,
    `${rows.length} vs ${all} - ${inactive} - ${mgmt}`)
  check('every row has a slug the route can find',
    rows.every((r) => r.slug === null || r.slug === r.cueverseId || r.slug.length > 0))

  /*
    The edit is one implementation behind two doors. A second copy of the sequence — validate,
    write, keep the login in step, propagate, audit, drop the cached ladder — is how two paths start
    disagreeing, which is the drift this system already had to be repaired once for.
  */
  const shared = readFileSync('src/lib/players/identity-edit.ts', 'utf8')
  check('the identity edit lives in one place', /export async function applyIdentityPatch/.test(shared))
  check('...and propagates the new spelling everywhere it was copied',
    /propagateIdentityChange/.test(shared))
  for (const caller of ['src/lib/creator/entrant-identity-actions.ts', 'src/lib/players/directory-actions.ts']) {
    const src = readFileSync(caller, 'utf8')
    check(`${caller.split('/').pop()} uses it rather than its own copy`,
      /applyIdentityPatch\(/.test(src) && !/propagateIdentityChange/.test(src))
  }

  /*
    Ordered the way /staff/members orders the same people.

    Two things were wrong before. The database's collation is `C`, raw byte order, so
    `ORDER BY cueverseId` put every capital ahead of every lowercase letter — DJBlaster before
    DeadPoolPrime. The first fix reached for `Intl.Collator`, which is worse in a subtler way: an
    unspecified locale asks the RUNTIME what alphabet it is using, exactly as collation asks the
    database, so the list can order differently on a developer's machine than in production.

    `compareMembersByName` folds case explicitly and compares codepoints, so it answers the same
    everywhere — and it is already the comparator the staff member list uses, which is what makes
    the two pages agree about the same names.
  */
  const order = rows.map((r) => ({ cueverseId: r.cueverseId, preferredName: r.preferredName }))
  const expected = [...order].sort(compareMembersByName)
  check('the directory uses the shared member order', JSON.stringify(order) === JSON.stringify(expected))

  const dir2 = readFileSync('src/lib/players/directory.ts', 'utf8')
  check('...the shared comparator, not a private one', /compareMembersByName/.test(dir2))
  /* Stripped, not raw: the comment explaining why it is not used names it, and prose is not code. */
  const dirCode = dir2.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
  check('...not a locale-dependent one', !/Intl\.Collator|localeCompare/.test(dirCode))
  check('...and not the database collation', !/orderBy: \[\{ cueverseId/.test(dir2))

  /* Case folding is the whole point: a capital must not jump the queue. */
  const folded = compareMembersByName(
    { cueverseId: 'DeadPoolPrime', preferredName: 'DeadPoolPrime' },
    { cueverseId: 'DJBlaster', preferredName: 'DJBlaster' })
  check('"DeadPoolPrime" sorts before "DJBlaster", which byte order got wrong', folded < 0)

  /* Headers sort, the same affordance the staff list offers. */
  const table2 = readFileSync('src/components/players/players-directory.tsx', 'utf8')
  check('the columns can be sorted from their headings', /function SortHeader/.test(table2))
  check('...using the same comparator as the staff list', /compareMembersByColumn/.test(table2))
  check('...announcing the direction to a screen reader', /aria-sort=/.test(table2))
  check('...and clicking the chosen column again reverses it',
    /s\?\.col === col \? \{ col, dir: s\.dir === 'asc' \? 'desc' : 'asc' \}/.test(table2))
  /*
    The chosen column has to survive a search. Comparing file positions would only compare against
    the import line, so this checks the thing that matters: the sort is applied to what the filter
    returned, not to the unfiltered list.
  */
  check('a search does not discard the chosen column',
    /\[\.\.\.matched\]\.sort\(/.test(table2))

  /*
    A refused handle must leave the record untouched.

    `changeCueverseId` spans the Player row and the Payload login and is atomic about it — it
    reverts its own write if the login sync fails — and it can be refused outright, most commonly
    because the handle is already taken. The preferred name is a single update that all but cannot
    fail. Writing the name FIRST meant a refused handle returned an error with the name already
    committed: the operator is told the edit failed while half of it has landed.
  */
  const editSrc = readFileSync('src/lib/players/identity-edit.ts', 'utf8')
  check('the fallible change is attempted first',
    editSrc.indexOf('changeCueverseId(') < editSrc.indexOf('updateProfile('))

  /*
    And the cache clear cannot turn a completed write into a reported failure. `revalidatePath`
    throws outside a request context, which is where a script and the verification suite call from.
  */
  check('the cache clear is guarded', /invalidate\(\(\) => \{/.test(editSrc))
  check('...so a non-request caller still completes', /catch \{\n    \/\/ No request context/.test(editSrc))

  /* Matches and Account are administrative detail, not what a visitor came for. */
  const table = readFileSync('src/components/players/players-directory.tsx', 'utf8')
  check('non-admins are not shown the Matches column',
    /\{canEdit && <th[^>]*>Matches<\/th>\}/.test(table))
  check('...nor the Account column', /\{canEdit && <th[^>]*>Account<\/th>\}/.test(table))
  check('...and the rows match the headers',
    /\{canEdit && <td[^>]*>\{p\.matches \|\| '—'\}<\/td>\}/.test(table))
  check('...including the empty state, which must span the right number',
    /colSpan=\{canEdit \? 5 : 2\}/.test(table))

  /* The gate is on the action, because a form that is not drawn stops nobody. */
  const action = readFileSync('src/lib/players/directory-actions.ts', 'utf8')
  check('the directory edit requires manage_players', /requireCapability\('manage_players'\)/.test(action))
  const page = readFileSync('src/app/(frontend)/players/page.tsx', 'utf8')
  check('...and the page only decides whether to DRAW the controls',
    /can\('manage_players'\)/.test(page) && /canEdit/.test(page))
}

await prisma.$disconnect()
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
