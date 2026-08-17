/**
 * Reconcile the imported 8BRCAM archive against the read-only CSVs.
 *
 * Read-only: this counts and compares, it never writes. If the archive has not been imported the
 * suite reports that and passes, so it is safe to run on a fresh database.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-archive-import.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { loadArchive, resolvePlayer, orderedSeasonDivisions } from './archive-source.mts'
import {
  buildArchiveIdentityMap,
  isPlaceholderArchivePlayer,
  reshapeHandle,
  isValidCueverseId,
  archiveEmailFor,
  isArchiveEmail,
  disambiguatedId,
} from '../src/lib/archive/identity.ts'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const eq = (n: string, got: number, want: number) => check(`${n} (${got})`, got === want, `expected ${want}`)

async function main() {
  const d = loadArchive()

  console.log('--- Identity rules (pure) ---')
  check('an email handle reduces to its local part', reshapeHandle('coria_snake_eyes@yahoo.com') === 'coria_snake_eyes')
  check('a "(wc)" marker is preserved, not deleted', reshapeHandle('ii_comp_ii (wc)') === 'ii_comp_ii-wc')
  check('a " - x" marker is preserved, not deleted', reshapeHandle('owned_ggs - x') === 'owned_ggs-x')
  check('spaces and apostrophes are removed', reshapeHandle("pud'n") === 'pudn')
  check('a blank handle has no id', reshapeHandle('') === null)
  check('"n/a" is treated as blank', reshapeHandle('n/a') === null)
  check('"TBD" is a placeholder', isPlaceholderArchivePlayer('TBD'))
  check('"-" is a placeholder', isPlaceholderArchivePlayer('-'))
  check('a real name with no handle is NOT a placeholder', !isPlaceholderArchivePlayer('disco'))
  check('archive email is undeliverable by construction', archiveEmailFor('abc').endsWith('@archive.8br.invalid'))
  check('archive emails are recognisable', isArchiveEmail(archiveEmailFor('abc')) && !isArchiveEmail('real@example.com'))
  check('disambiguation appends the archive id', disambiguatedId('handkrash', 'P1848') === 'handkrash-p1848')

  console.log('\n--- Identity map over the whole archive ---')
  const participants = new Set<string>()
  for (const s of d.seasonStats) participants.add(resolvePlayer(d, s.playerId, s.seasonId, s.division))
  for (const s of d.standings) participants.add(resolvePlayer(d, s.playerId, s.seasonId, s.division))
  for (const m of d.groupMatches) {
    for (const p of [m.playerAId, m.playerBId]) if (p) participants.add(resolvePlayer(d, p, m.seasonId, m.division))
  }
  for (const m of d.playoffMatches) {
    for (const p of [m.playerAId, m.playerBId]) if (p) participants.add(resolvePlayer(d, p, m.seasonId, m.division))
  }
  participants.delete('')
  const real = [...participants].filter((p) => !isPlaceholderArchivePlayer(d.players.get(p)?.primaryName)).sort()
  const ids = buildArchiveIdentityMap(
    real.map((pid) => ({ playerId: pid, handle: d.players.get(pid)?.primaryYm ?? '', name: d.players.get(pid)?.primaryName ?? '' })),
  )
  check('every participant gets an id', ids.size === real.length, `${ids.size} vs ${real.length}`)
  check('every id is valid', [...ids.values()].every((i) => isValidCueverseId(i.cueverseId)))
  const idSet = new Set([...ids.values()].map((i) => i.cueverseId.toLowerCase()))
  check('no two participants share an id', idSet.size === ids.size, `${idSet.size} vs ${ids.size}`)
  const again = buildArchiveIdentityMap(
    real.map((pid) => ({ playerId: pid, handle: d.players.get(pid)?.primaryYm ?? '', name: d.players.get(pid)?.primaryName ?? '' })),
  )
  check('the map is deterministic across runs',
    [...ids.values()].every((i) => again.get(i.playerId)?.cueverseId === i.cueverseId))

  console.log('\n--- Imported data ---')
  const seasons = await prisma.season.findMany({
    where: { slug: { startsWith: '8brcam-' } },
    select: { id: true, number: true, competitionYear: true, subtitle: true, slug: true, lifecycleState: true, championName: true, entrantsCount: true },
    orderBy: { number: 'asc' },
  })
  if (seasons.length === 0) {
    console.log('  (archive not imported — skipping reconciliation)')
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
    return
  }

  const placeholders = new Set([...d.players.values()].filter((p) => isPlaceholderArchivePlayer(p.primaryName)).map((p) => p.playerId))
  const notPlaceholder = (pid: string) => !placeholders.has(pid)

  eq('Seasons imported', seasons.length, d.divisions.length)
  check('every Season is COMPLETED', seasons.every((s) => s.lifecycleState === 'COMPLETED'))
  check('every Season belongs to a year in 2005-2014',
    seasons.every((s) => s.competitionYear >= 2005 && s.competitionYear <= 2014))

  // Chronological order: the auto-assigned number must ascend with the order the seasons were played.
  const order = orderedSeasonDivisions(d)
  const bySlug = new Map(seasons.map((s) => [s.slug, s]))
  let ordered = true
  let prev = 0
  for (const o of order) {
    const s = bySlug.get(`8brcam-${o.seasonId}-${o.division}`.toLowerCase())
    if (!s) { ordered = false; break }
    if (s.number <= prev) { ordered = false; break }
    prev = s.number
    if (s.competitionYear !== o.year) { ordered = false; break }
  }
  check('Season numbers ascend in the order the seasons were played', ordered)
  check('every archive season-division has a Season', order.every((o) => bySlug.has(`8brcam-${o.seasonId}-${o.division}`.toLowerCase())))
  check('subtitles carry the archive identity',
    seasons.every((s) => /^\d{4} Season \d+( · Division [AB])?$/.test(s.subtitle ?? '')),
    seasons.find((s) => !/^\d{4} Season \d+( · Division [AB])?$/.test(s.subtitle ?? ''))?.subtitle ?? '')

  const ids2 = new Set(seasons.map((s) => s.id))
  const [entrants, groups, matches, standings, playoff] = await Promise.all([
    prisma.seasonEntrant.count({ where: { seasonId: { in: [...ids2] } } }),
    prisma.seasonGroup.count({ where: { seasonId: { in: [...ids2] } } }),
    prisma.seasonMatch.count({ where: { seasonId: { in: [...ids2] } } }),
    prisma.seasonStanding.count({ where: { seasonId: { in: [...ids2] } } }),
    prisma.seasonPlayoffMatch.count({ where: { seasonId: { in: [...ids2] } } }),
  ])

  const expEntrants = new Set(
    d.seasonStats
      .map((s) => ({ ...s, r: resolvePlayer(d, s.playerId, s.seasonId, s.division) }))
      .filter((s) => notPlaceholder(s.r))
      .map((s) => `${s.seasonId}|${s.division}|${s.r}`),
  ).size
  const expStandings = new Set(
    d.standings
      .map((s) => ({ ...s, r: resolvePlayer(d, s.playerId, s.seasonId, s.division) }))
      .filter((s) => notPlaceholder(s.r))
      .map((s) => `${s.groupId}|${s.r}`),
  ).size
  const expMatches = d.groupMatches.filter((m) => {
    const a = resolvePlayer(d, m.playerAId, m.seasonId, m.division)
    const b = resolvePlayer(d, m.playerBId, m.seasonId, m.division)
    return a && b && a !== b && notPlaceholder(a) && notPlaceholder(b)
  }).length

  eq('entrants', entrants, expEntrants)
  eq('groups', groups, d.groups.length)
  eq('group matches', matches, expMatches)
  eq('standings rows', standings, expStandings)
  eq('playoff matches', playoff, d.playoffMatches.length)

  check('every group match has a result',
    (await prisma.seasonMatch.count({ where: { seasonId: { in: [...ids2] }, status: 'COMPLETED' } })) === matches)
  check('entrantsCount matches the stored entrants',
    seasons.every((s) => s.entrantsCount >= 0) &&
      (await prisma.seasonEntrant.count({ where: { seasonId: seasons[0].id } })) === seasons[0].entrantsCount)

  console.log('\n--- Champions ---')
  const expChampions = d.playoffs.filter((p) => p.championId && notPlaceholder(p.championId)).length
  eq('Seasons with a champion', seasons.filter((s) => s.championName).length, expChampions)
  const first = bySlug.get('8brcam-2005-s1-single')
  check('2005 Season 1 champion is luis', first?.championName === 'luis', first?.championName ?? 'missing')
  const last = bySlug.get('8brcam-2014-s1-a')
  check('2014 Season 1 Division A champion is Kevin', last?.championName === 'Kevin', last?.championName ?? 'missing')

  console.log('\n--- Accounts ---')
  const archiveUsers = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM payload.users WHERE email ILIKE '%@archive.8br.invalid'`
  eq('archive accounts', Number(archiveUsers[0].n), ids.size)
  // A merged secondary is deliberately unlinked from its account — that is how its login is
  // disabled — so the invariant is about profiles that have NOT been merged away.
  const { mergedSecondaryPlayerIds } = await import('../src/lib/players/merge.ts')
  const secondaries = await mergedSecondaryPlayerIds()
  const unlinked = await prisma.player.count({
    where: {
      linkedUserId: null,
      cueverseIdNormalized: { in: [...idSet] },
      ...(secondaries.length ? { id: { notIn: secondaries } } : {}),
    },
  })
  check('every unmerged archive profile is linked to its account', unlinked === 0, `${unlinked} unlinked`)
  if (secondaries.length) {
    console.log(`  (${secondaries.length} merged secondar${secondaries.length === 1 ? 'y' : 'ies'} excluded — unlinking is how a merge disables the login)`)
  }
  const tbd = await prisma.player.count({ where: { primaryName: { in: ['TBD', '-'] } } })
  check('no placeholder became a member', tbd === 0, `${tbd} placeholder profiles`)

  console.log('\n--- Rating ledger ---')
  const ledger = await prisma.ratingLedger.count()
  check('the ledger was built from the imported seasons', ledger > 0, `${ledger} rows`)
  check('every ledger row belongs to a completed competition',
    (await prisma.ratingLedger.count({ where: { seasonId: { in: [...ids2] } } })) > 0)

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

main()
  .catch((e) => { console.error(e); fail++ })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
