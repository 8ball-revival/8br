/**
 * Import the 8BRCAM archive (2005-2014) into the live Season domain.
 *
 * Every archive season-division becomes one Season under the 8BRCAM Competition, walked through
 * the real lifecycle with the real services, so the result is indistinguishable from a season that
 * was run on the site.
 *
 * Where the archive and the live tools disagree, the ARCHIVE WINS — it is the historical record:
 *
 *   - Group fixtures are the archive's actual matches, not a generated round-robin. The publish
 *     step's scheduler assumes a season about to be played; these were played in 2008.
 *   - Final standings are the archive's, not recomputed. Historical seasons used several scoring
 *     models (see `score_model`) that today's Win 3 / Draw 1 / Loss 0 engine cannot reproduce.
 *   - Champions come from `playoffs.csv`, not from walking the bracket. Many brackets are partial
 *     reconstructions, but the champion is recorded directly.
 *
 * The rating ledger is rebuilt ONCE at the end rather than per season. `closeSeason` triggers a
 * full deterministic rebuild every time it runs; doing that 94 times would repeat identical work.
 *
 * Idempotent: Seasons are keyed by slug (`8brcam-<seasonId>-<division>`) and accounts by CueVerse
 * ID, so a re-run resumes rather than duplicates.
 *
 * Run (needs the ESM flip for Payload):
 *   node scripts/run-with-esm.mjs npx tsx --tsconfig scripts/tsconfig.verify.json scripts/import-archive.mts --phase=all
 *
 * Flags: --phase=accounts|seasons|competition|ledger|all  --limit=N  --dry-run  --quiet
 */
// A bare tsx process gets no env, but Payload needs PAYLOAD_SECRET + DATABASE_URL at init.
// ONLY `.env`: `.env.local` carries BLOB_READ_WRITE_TOKEN, which would switch media storage to a
// real Vercel Blob store. An import into the contained database must never reach cloud storage.
try {
  process.loadEnvFile('.env')
} catch {
  /* absent file is fine */
}

import { prisma } from '../src/lib/prisma.ts'
import { createMember } from '../src/lib/staff/create-member-service.ts'
import { buildArchiveIdentityMap, archiveEmailFor, disambiguatedId, isPlaceholderArchivePlayer, type ArchiveIdentity } from '../src/lib/archive/identity.ts'
import { createSeason } from '../src/lib/seasons/service.ts'
import { addSeasonEntrant, closeRegistration } from '../src/lib/seasons/service.ts'
import { addSeasonGroup, moveSeasonEntrantToGroup } from '../src/lib/seasons/groups.ts'
import { closeSeasonGroups } from '../src/lib/seasons/group-stage.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'
import { loadArchive, orderedSeasonDivisions, resolvePlayer, type ArchiveData } from './archive-source.mts'
import { randomBytes } from 'node:crypto'

const args = process.argv.slice(2)
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const has = (n: string) => args.includes(`--${n}`)
const PHASE = flag('phase') ?? 'all'
const LIMIT = Number(flag('limit') ?? 0) || 0
const DRY = has('dry-run')
const QUIET = has('quiet')

const COMPETITION_SLUG = '8brcam'
const log = (m: string) => console.log(m)
const vlog = (m: string) => { if (!QUIET) console.log(m) }
const runPhase = (p: string) => PHASE === 'all' || PHASE === p

/** Stable, unique key that makes the whole import re-runnable. */
const seasonSlug = (seasonId: string, division: string) => `${COMPETITION_SLUG}-${seasonId}-${division}`.toLowerCase()

/**
 * The archive records a year, not a date, so results are stamped 1 January.
 *
 * NOON UTC, not midnight: midnight UTC is the previous day everywhere west of Greenwich, which
 * would make every archive result read as 31 December across the Americas. Noon is the same
 * calendar day from UTC-11 to UTC+11.
 */
const archiveStamp = (year: number) => new Date(Date.UTC(year, 0, 1, 12))

const divisionLabel = (d: string) => (d === 'single' ? null : `Division ${d}`)
function subtitleFor(seasonId: string, division: string, year: number, period: number): string {
  const base = `${year} Season ${period}`
  const dl = divisionLabel(division)
  return dl ? `${base} · ${dl}` : base
}

// --------------------------------------------------------------------------- actor

async function resolveActor(): Promise<{ userId: number; username: string }> {
  const rows = await prisma.$queryRaw<{ id: number; username: string }[]>`
    SELECT u.id, u.username FROM payload.users u
    JOIN payload.users_roles r ON r.parent_id = u.id
    WHERE r.value = 'owner' ORDER BY u.id ASC LIMIT 1`
  if (rows.length) return { userId: Number(rows[0].id), username: rows[0].username }
  const any = await prisma.$queryRaw<{ id: number; username: string }[]>`
    SELECT id, username FROM payload.users ORDER BY id ASC LIMIT 1`
  if (!any.length) throw new Error('No user exists to attribute the import to.')
  return { userId: Number(any[0].id), username: any[0].username }
}

// --------------------------------------------------------------------------- phase: accounts

/** Every archive player who actually appears in a season, after merge/split corrections. */
function participantsOf(data: ArchiveData): Set<string> {
  const set = new Set<string>()
  for (const s of data.seasonStats) set.add(resolvePlayer(data, s.playerId, s.seasonId, s.division))
  for (const s of data.standings) set.add(resolvePlayer(data, s.playerId, s.seasonId, s.division))
  for (const m of data.groupMatches) {
    if (m.playerAId) set.add(resolvePlayer(data, m.playerAId, m.seasonId, m.division))
    if (m.playerBId) set.add(resolvePlayer(data, m.playerBId, m.seasonId, m.division))
  }
  for (const m of data.playoffMatches) {
    if (m.playerAId) set.add(resolvePlayer(data, m.playerAId, m.seasonId, m.division))
    if (m.playerBId) set.add(resolvePlayer(data, m.playerBId, m.seasonId, m.division))
  }
  set.delete('')
  // Slot fillers ("TBD", "-") are not competitors and must never become accounts.
  for (const pid of [...set]) {
    if (isPlaceholderArchivePlayer(data.players.get(pid)?.primaryName)) set.delete(pid)
  }
  return set
}

function buildIdentities(data: ArchiveData): Map<string, ArchiveIdentity> {
  const participants = [...participantsOf(data)].sort()
  return buildArchiveIdentityMap(
    participants.map((pid) => {
      const p = data.players.get(pid)
      return { playerId: pid, handle: p?.primaryYm ?? '', name: p?.primaryName ?? '' }
    }),
  )
}

interface AccountLink { userId: number; playerId: string; cueverseId: string }

/**
 * Decide which CueVerse ID this archive player should own, given what is already in the database.
 *
 * Three outcomes: the account is already ours (reuse it), the id is free (take it), or a real
 * member holds it (step aside and take a suffixed id instead). Because the archive-side id is a
 * pure function of the archive, re-running the import lands on the same answer every time.
 */
async function resolveAccount(
  id: ArchiveIdentity,
): Promise<{ cueverseId: string; existing?: AccountLink; collidedWith?: string }> {
  let steppedAside: string | undefined
  for (const candidate of [id.cueverseId, disambiguatedId(id.cueverseId, id.playerId)]) {
    const player = await prisma.player.findFirst({
      where: { cueverseIdNormalized: candidate.toLowerCase() },
      select: { id: true, linkedUserId: true },
    })
    if (!player) return { cueverseId: candidate, collidedWith: steppedAside }

    // Somebody holds it. Ours if the linked account carries this archive id's minted address.
    let mine = false
    if (player.linkedUserId) {
      const rows = await prisma.$queryRaw<{ email: string }[]>`
        SELECT email FROM payload.users WHERE id = ${Number(player.linkedUserId)} LIMIT 1`
      mine = rows.length > 0 && rows[0].email.toLowerCase() === archiveEmailFor(candidate).toLowerCase()
    }
    if (mine && player.linkedUserId) {
      return { cueverseId: candidate, existing: { userId: Number(player.linkedUserId), playerId: player.id, cueverseId: candidate } }
    }
    if (candidate === id.cueverseId) { steppedAside = candidate; continue } // held by someone else
    return { cueverseId: candidate, collidedWith: id.cueverseId }
  }
  return { cueverseId: disambiguatedId(id.cueverseId, id.playerId), collidedWith: id.cueverseId }
}

async function phaseAccounts(
  data: ArchiveData,
  ids: Map<string, ArchiveIdentity>,
  actor: { userId: number; username: string },
): Promise<Map<string, AccountLink>> {
  const links = new Map<string, AccountLink>()
  const entries = [...ids.values()]
  const slice = LIMIT ? entries.slice(0, LIMIT) : entries
  let created = 0, existing = 0, failed = 0
  const failures: string[] = []
  const collisions: string[] = []

  for (const [i, id] of slice.entries()) {
    const resolved = await resolveAccount(id)
    if (resolved.collidedWith) {
      collisions.push(`${id.playerId}: "${resolved.collidedWith}" is taken by an existing member → ${resolved.cueverseId}`)
    }
    if (resolved.existing) {
      links.set(id.playerId, resolved.existing)
      existing++
    } else if (DRY) {
      created++
    } else {
      // A long random password: these accounts are provisioned, not handed out. Nobody, including
      // this script's output, ever sees it — a member takes ownership through password reset.
      const res = await createMember(actor, {
        cueverseId: resolved.cueverseId,
        preferredName: id.preferredName ?? undefined,
        email: archiveEmailFor(resolved.cueverseId),
        password: randomBytes(24).toString('base64url'),
      })
      if (res.ok && res.userId && res.playerId) {
        links.set(id.playerId, { userId: res.userId, playerId: res.playerId, cueverseId: resolved.cueverseId })
        created++
      } else {
        failed++
        if (failures.length < 15) failures.push(`${id.playerId} (${resolved.cueverseId}): ${res.error}`)
      }
    }
    if (!QUIET && (i + 1) % 250 === 0) log(`   accounts ${i + 1}/${slice.length}…`)
  }

  log(`   accounts: ${created} created, ${existing} already present, ${failed} failed`)
  for (const f of failures) log(`     ! ${f}`)
  if (collisions.length) {
    log(`   ${collisions.length} id collision(s) with existing members:`)
    for (const c of collisions.slice(0, 20)) log(`     ~ ${c}`)
  }
  return links
}

/** Re-read the account links for phases that run without the accounts phase. */
async function loadLinks(ids: Map<string, ArchiveIdentity>): Promise<Map<string, AccountLink>> {
  const links = new Map<string, AccountLink>()
  for (const id of ids.values()) {
    const resolved = await resolveAccount(id)
    if (resolved.existing) links.set(id.playerId, resolved.existing)
  }
  return links
}

// --------------------------------------------------------------------------- phase: competition

async function ensureCompetition(): Promise<number> {
  const found = await prisma.competitionSeries.findUnique({ where: { slug: COMPETITION_SLUG }, select: { id: true, active: true } })
  if (found) {
    if (!found.active) await prisma.competitionSeries.update({ where: { id: found.id }, data: { active: true } })
    return found.id
  }
  if (DRY) return -1
  const made = await prisma.competitionSeries.create({
    data: { name: '8BRCAM', shortName: '8BRCAM', slug: COMPETITION_SLUG, active: true },
    select: { id: true },
  })
  return made.id
}

// --------------------------------------------------------------------------- phase: seasons

const scoreRe = /^\s*(\d+)\s*[-–]\s*(\d+)\s*$/

interface SeasonPlan {
  seasonId: string; division: string; year: number; period: number
}

async function importOneSeason(
  data: ArchiveData,
  plan: SeasonPlan,
  competitionId: number,
  links: Map<string, AccountLink>,
  actor: { userId: number; username: string },
): Promise<{ ok: boolean; skipped?: boolean; error?: string; stats?: Record<string, number> }> {
  const { seasonId, division, year, period } = plan
  const slug = seasonSlug(seasonId, division)

  const existing = await prisma.season.findUnique({ where: { slug }, select: { id: true, lifecycleState: true } })
  if (existing && existing.lifecycleState === 'COMPLETED') return { ok: true, skipped: true }
  if (DRY) return { ok: true, stats: {} }

  // ---- 1. the Season record, through the real creation service
  let dbSeasonId: number
  if (existing) {
    dbSeasonId = existing.id
  } else {
    const res = await createSeason(actor, {
      competitionSeriesId: competitionId,
      competitionYear: year,
      lounge: 'Social',
      accessMode: 'OPEN',
    })
    if (!res.ok || !res.number) return { ok: false, error: `createSeason: ${res.error}` }
    const row = await prisma.season.findFirst({ where: { number: res.number }, select: { id: true } })
    if (!row) return { ok: false, error: 'created Season vanished' }
    dbSeasonId = row.id
    // Repurpose the slug as the archive key and record the archive identity in the subtitle.
    await prisma.season.update({
      where: { id: dbSeasonId },
      data: { slug, subtitle: subtitleFor(seasonId, division, year, period) },
    })
  }

  const state = async () =>
    (await prisma.season.findUnique({ where: { id: dbSeasonId }, select: { lifecycleState: true } }))!.lifecycleState
  const go = async (to: Parameters<typeof transitionSeasonState>[2]) => {
    const t = await transitionSeasonState(actor, dbSeasonId, to)
    if (!t.ok) throw new Error(`${seasonId}/${division} → ${to}: ${t.error}`)
  }

  // ---- 2. entrants
  if (await state() === 'REGISTRATION_SCHEDULED') await go('REGISTRATION_OPEN')

  const rosterIds = new Set<string>()
  for (const s of data.seasonStats) {
    if (s.seasonId === seasonId && s.division === division) rosterIds.add(resolvePlayer(data, s.playerId, seasonId, division))
  }
  for (const s of data.standings) {
    if (s.seasonId === seasonId && s.division === division) rosterIds.add(resolvePlayer(data, s.playerId, seasonId, division))
  }
  rosterIds.delete('')

  if (await state() === 'REGISTRATION_OPEN') {
    for (const pid of [...rosterIds].sort()) {
      const link = links.get(pid)
      if (!link) continue
      const r = await addSeasonEntrant(actor, dbSeasonId, link.playerId)
      if (!r.ok && !/already entered/i.test(r.error ?? '')) {
        return { ok: false, error: `addSeasonEntrant ${pid}: ${r.error}` }
      }
    }
    const close = await closeRegistration(actor, dbSeasonId)
    if (!close.ok) return { ok: false, error: `closeRegistration: ${close.error}` }
  }

  const entrants = await prisma.seasonEntrant.findMany({
    where: { seasonId: dbSeasonId },
    select: { id: true, playerId: true },
  })
  const entrantByPlayer = new Map<string, number>()
  for (const e of entrants) if (e.playerId) entrantByPlayer.set(e.playerId, e.id)
  /** archive player id -> season entrant id */
  const entrantOf = (archivePid: string): number | undefined => {
    const link = links.get(archivePid)
    return link ? entrantByPlayer.get(link.playerId) : undefined
  }

  // ---- 3. groups (real services for structure)
  const archiveGroups = data.groups
    .filter((g) => g.seasonId === seasonId && g.division === division)
    .sort((a, b) => a.letter.localeCompare(b.letter) || a.groupId.localeCompare(b.groupId))

  if (await state() === 'REGISTRATION_CLOSED') await go('GROUP_SETUP')

  if (await state() === 'GROUP_SETUP') {
    const have = await prisma.seasonGroup.count({ where: { seasonId: dbSeasonId } })
    for (let i = have; i < archiveGroups.length; i++) {
      const r = await addSeasonGroup(actor, dbSeasonId)
      if (!r.ok) return { ok: false, error: `addSeasonGroup: ${r.error}` }
    }
    const dbGroups = await prisma.seasonGroup.findMany({
      where: { seasonId: dbSeasonId }, orderBy: { ordinal: 'asc' }, select: { id: true },
    })
    // Archive group order == created order, so index maps archive group -> db group.
    for (const [i, ag] of archiveGroups.entries()) {
      const dbg = dbGroups[i]
      if (!dbg) break
      const members = data.standings.filter((s) => s.groupId === ag.groupId)
      for (const m of members) {
        const eid = entrantOf(resolvePlayer(data, m.playerId, seasonId, division))
        if (!eid) continue
        const r = await moveSeasonEntrantToGroup(actor, dbSeasonId, eid, dbg.id)
        if (!r.ok) return { ok: false, error: `moveSeasonEntrant: ${r.error}` }
      }
      if (ag.letter) {
        await prisma.seasonGroup.update({ where: { id: dbg.id }, data: { name: `Group ${ag.letter}` } })
      }
    }
    // Publishing normally generates a round-robin for a season about to be played. These were
    // played years ago, so the archive's own fixtures are written instead (below).
    await prisma.seasonGroup.updateMany({ where: { seasonId: dbSeasonId }, data: { published: true } })
    await go('GROUP_STAGE_LIVE')
  }

  const dbGroups = await prisma.seasonGroup.findMany({
    where: { seasonId: dbSeasonId }, orderBy: { ordinal: 'asc' }, select: { id: true },
  })
  const dbGroupOf = new Map<string, number>()
  archiveGroups.forEach((ag, i) => { if (dbGroups[i]) dbGroupOf.set(ag.groupId, dbGroups[i].id) })

  // ---- 4. group matches (archive fixtures + results)
  let matchesWritten = 0
  if (await state() === 'GROUP_STAGE_LIVE') {
    const already = await prisma.seasonMatch.count({ where: { seasonId: dbSeasonId } })
    if (already === 0) {
      const rows = data.groupMatches.filter((m) => m.seasonId === seasonId && m.division === division)
      const payload = []
      for (const m of rows) {
        const gid = dbGroupOf.get(m.groupId) ?? dbGroups[0]?.id
        if (!gid) continue
        const aP = resolvePlayer(data, m.playerAId, seasonId, division)
        const bP = resolvePlayer(data, m.playerBId, seasonId, division)
        const a = entrantOf(aP), b = entrantOf(bP)
        if (!a || !b || a === b) continue
        const wP = m.winnerId ? resolvePlayer(data, m.winnerId, seasonId, division) : ''
        const w = wP ? entrantOf(wP) : undefined
        const played = m.scoreA != null && m.scoreB != null
        payload.push({
          seasonId: dbSeasonId, groupId: gid, round: 1,
          homeEntrantId: a, awayEntrantId: b,
          homeUsername: links.get(aP)?.cueverseId ?? '', awayUsername: links.get(bP)?.cueverseId ?? '',
          homeGames: m.scoreA, awayGames: m.scoreB,
          status: (played ? 'COMPLETED' : 'SCHEDULED') as 'COMPLETED' | 'SCHEDULED',
          winnerEntrantId: played ? (w ?? null) : null,
          loserEntrantId: played && w ? (w === a ? b : a) : null,
          completedAt: played ? archiveStamp(year) : null,
        })
      }
      if (payload.length) await prisma.seasonMatch.createMany({ data: payload })
      matchesWritten = payload.length
    }
    const close = await closeSeasonGroups(actor, dbSeasonId)
    if (!close.ok) return { ok: false, error: `closeSeasonGroups: ${close.error}` }
  }

  // ---- 5. standings: the archive's published table is authoritative
  const archiveStandings = data.standings.filter((s) => s.seasonId === seasonId && s.division === division)
  const qualified = new Set(
    data.seasonStats
      .filter((s) => s.seasonId === seasonId && s.division === division && s.madePlayoffs)
      .map((s) => resolvePlayer(data, s.playerId, seasonId, division)),
  )
  for (const s of archiveStandings) {
    const pid = resolvePlayer(data, s.playerId, seasonId, division)
    const eid = entrantOf(pid)
    const gid = dbGroupOf.get(s.groupId)
    if (!eid || !gid) continue
    await prisma.seasonStanding.upsert({
      where: { groupId_entrantId: { groupId: gid, entrantId: eid } },
      create: {
        seasonId: dbSeasonId, groupId: gid, entrantId: eid, username: links.get(pid)?.cueverseId ?? '',
        played: s.played, wins: s.wins, losses: s.losses, draws: s.draws,
        gamesWon: s.gamesFor, gamesLost: s.gamesAgainst,
        points: Math.round(s.total || s.points), rank: s.slot + 1, qualified: qualified.has(pid),
      },
      update: {
        played: s.played, wins: s.wins, losses: s.losses, draws: s.draws,
        gamesWon: s.gamesFor, gamesLost: s.gamesAgainst,
        points: Math.round(s.total || s.points), rank: s.slot + 1, qualified: qualified.has(pid),
      },
    })
  }

  // ---- 6. playoffs
  if (await state() === 'GROUPS_CLOSED') await go('PLAYOFF_SETUP')

  let playoffWritten = 0
  if (await state() === 'PLAYOFF_SETUP') {
    const already = await prisma.seasonPlayoffMatch.count({ where: { seasonId: dbSeasonId } })
    if (already === 0) {
      const seedOf = new Map<string, number>()
      for (const s of data.seeds) {
        if (s.seasonId === seasonId && s.division === division) {
          seedOf.set(resolvePlayer(data, s.playerId, seasonId, division), s.seed)
        }
      }
      const rows = data.playoffMatches
        .filter((m) => m.seasonId === seasonId && m.division === division)
        .sort((a, b) => a.round - b.round || a.matchNo - b.matchNo)
      const payload = []
      for (const m of rows) {
        const aP = m.playerAId ? resolvePlayer(data, m.playerAId, seasonId, division) : ''
        const bP = m.playerBId ? resolvePlayer(data, m.playerBId, seasonId, division) : ''
        const a = aP ? entrantOf(aP) : undefined
        const b = bP ? entrantOf(bP) : undefined
        const sm = scoreRe.exec(m.score)
        const wP = m.winnerId ? resolvePlayer(data, m.winnerId, seasonId, division) : ''
        const w = wP ? entrantOf(wP) : undefined
        payload.push({
          seasonId: dbSeasonId, round: m.round, slot: m.matchNo, label: m.roundName || null,
          homeEntrantId: a ?? null, awayEntrantId: b ?? null,
          homeUsername: aP ? links.get(aP)?.cueverseId ?? null : null,
          awayUsername: bP ? links.get(bP)?.cueverseId ?? null : null,
          homeSeed: aP ? seedOf.get(aP) ?? null : null,
          awaySeed: bP ? seedOf.get(bP) ?? null : null,
          homeGames: sm ? Number(sm[1]) : null,
          awayGames: sm ? Number(sm[2]) : null,
          status: (w || sm ? 'COMPLETED' : 'SCHEDULED') as 'COMPLETED' | 'SCHEDULED',
          winnerEntrantId: w ?? null,
          published: true,
          completedAt: w || sm ? archiveStamp(year) : null,
        })
      }
      if (payload.length) await prisma.seasonPlayoffMatch.createMany({ data: payload })
      playoffWritten = payload.length
    }
    await go('PLAYOFFS_LIVE')
  }

  // ---- 7. finalise with the archive's recorded champion
  if (await state() === 'PLAYOFFS_LIVE') {
    const po = data.playoffs.find((p) => p.seasonId === seasonId && p.division === division)
    const champPid = po?.championId ? resolvePlayer(data, po.championId, seasonId, division) : ''
    const runnerPid = po?.runnerUpId ? resolvePlayer(data, po.runnerUpId, seasonId, division) : ''
    const champLink = champPid ? links.get(champPid) : undefined
    const runnerLink = runnerPid ? links.get(runnerPid) : undefined
    const nameOf = (pid: string, fallback: string) =>
      (data.players.get(pid)?.primaryName || '').trim() || fallback || null

    await prisma.season.update({
      where: { id: dbSeasonId },
      data: {
        championName: champPid ? nameOf(champPid, po?.championHandle ?? '') : null,
        championHandle: champLink?.cueverseId ?? po?.championHandle ?? null,
        championPlayerId: champLink?.playerId ?? null,
        runnerUpName: runnerPid ? nameOf(runnerPid, po?.runnerUpHandle ?? '') : null,
      },
    })
    await go('COMPLETED')
  }

  return { ok: true, stats: { entrants: rosterIds.size, groups: archiveGroups.length, matches: matchesWritten, playoff: playoffWritten } }
}

// --------------------------------------------------------------------------- main

async function main() {
  const started = Date.now()
  log('=== 8BRCAM archive import ===')
  if (DRY) log('(dry run — nothing is written)')

  const data = loadArchive()
  const actor = await resolveActor()
  log(`archive: ${data.seasons.length} seasons, ${data.divisions.length} season-divisions, ${data.players.size} players`)
  log(`actor  : ${actor.username} (#${actor.userId})`)

  const ids = buildIdentities(data)
  log(`identities: ${ids.size} participants resolved`)

  const competitionId = await ensureCompetition()
  log(`competition: 8BRCAM (#${competitionId})`)

  let links: Map<string, AccountLink>
  if (runPhase('accounts')) {
    log('\n-- phase: accounts --')
    links = await phaseAccounts(data, ids, actor)
    const merged = await loadLinks(ids)
    for (const [k, v] of merged) if (!links.has(k)) links.set(k, v)
  } else {
    links = await loadLinks(ids)
    log(`accounts: ${links.size} existing links loaded`)
  }

  if (runPhase('seasons')) {
    log('\n-- phase: seasons --')
    const order = orderedSeasonDivisions(data)
    const slice = LIMIT ? order.slice(0, LIMIT) : order
    let done = 0, skipped = 0, failed = 0
    for (const plan of slice) {
      const res = await importOneSeason(data, plan, competitionId, links, actor).catch((e) => ({
        ok: false as const, error: e instanceof Error ? e.message : String(e),
      }))
      if (res.ok && res.skipped) { skipped++; vlog(`   = ${plan.seasonId}/${plan.division} already complete`) }
      else if (res.ok) {
        done++
        const s = res.stats ?? {}
        vlog(`   + ${plan.seasonId}/${plan.division}  entrants=${s.entrants ?? 0} groups=${s.groups ?? 0} matches=${s.matches ?? 0} playoff=${s.playoff ?? 0}`)
      } else { failed++; log(`   ! ${plan.seasonId}/${plan.division}: ${res.error}`) }
    }
    log(`seasons: ${done} imported, ${skipped} already complete, ${failed} failed`)
  }

  if (runPhase('ledger') && !DRY) {
    log('\n-- phase: rating ledger --')
    const { rebuildRatingLedger } = await import('../src/lib/stats/ledger.ts')
    await prisma.$transaction(async (tx) => { await rebuildRatingLedger(tx) }, { timeout: 15 * 60_000 })
    const n = await prisma.ratingLedger.count()
    log(`rating ledger: ${n} rows`)
  }

  log(`\ndone in ${Math.round((Date.now() - started) / 1000)}s`)
}

let failedRun = false
main()
  .catch((e) => { console.error(e); failedRun = true })
  .finally(async () => {
    await prisma.$disconnect()
    // Payload keeps its own pool open, which would hold the process alive after the work is done.
    process.exit(failedRun ? 1 : 0)
  })
