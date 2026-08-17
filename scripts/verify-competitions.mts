/**
 * Verification for Competition ownership + administration.
 *
 * Exercises the service layer directly (the same code the gated server actions call) plus the
 * database constraints. Everything it creates is removed again, so it is safe to re-run.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-competitions.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import {
  createCompetition,
  updateCompetition,
  deleteCompetition,
  listActiveCompetitions,
  listCompetitionsForAdmin,
} from '../src/lib/competitions/service.ts'
import { competitionInitials, competitionIconUrl, slugifyCompetition } from '../src/lib/competitions/shared.ts'
import { createSeason } from '../src/lib/seasons/service.ts'
import { isAdminUser } from '../src/collections/access.ts'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const actor: any = { userId: 1, username: 'verify', roles: ['owner'] }
const made: number[] = []

async function main() {
  console.log('--- Pure helpers (client-safe) ---')
  check('initials from an acronym', competitionInitials('8BRCAM') === '8B')
  check('initials from two words', competitionInitials('World Series') === 'WS')
  check('initials never empty', competitionInitials('') === '??')
  check('icon url is null without an icon', competitionIconUrl(null) === null)
  check('icon url uses the Payload media route', competitionIconUrl('x.png') === '/api/media/file/x.png')
  check('slugify lowercases + hyphenates', slugifyCompetition('8BR Cam Series') === '8br-cam-series')

  console.log('\n--- Permissions (ADMIN/OWNER only) ---')
  check('owner may manage Competitions', isAdminUser({ roles: ['owner'] }) === true)
  check('admin may manage Competitions', isAdminUser({ roles: ['admin'] }) === true)
  check('member may NOT', isAdminUser({ roles: ['member'] }) === false)
  check('retired editor may NOT', isAdminUser({ roles: ['editor'] }) === false)
  check('anonymous may NOT', isAdminUser(null) === false)

  console.log('\n--- Create / validate ---')
  const bad = await createCompetition(actor, { name: '' })
  check('rejects an empty name', !bad.ok)
  const made1 = await createCompetition(actor, { name: 'Verify Cup Series', shortName: 'VCS' })
  check('creates a Competition', made1.ok && !!made1.competition)
  if (made1.competition) made.push(made1.competition.id)
  check('derives a slug', made1.competition?.slug === 'vcs', made1.competition?.slug)
  check('new Competitions are active', made1.competition?.active === true)
  check('no icon yet → initials fallback', made1.competition?.iconMediaId === null)
  const dupe = await createCompetition(actor, { name: 'Other', shortName: 'VCS' })
  check('rejects a duplicate slug', !dupe.ok)

  console.log('\n--- Icon attach / replace / remove ---')
  const id = made1.competition!.id
  const withIcon = await updateCompetition(actor, id, { iconMediaId: 'icon-a.png' })
  check('attaches an icon', withIcon.competition?.iconMediaId === 'icon-a.png')
  const replaced = await updateCompetition(actor, id, { iconMediaId: 'icon-b.png' })
  check('replaces an icon', replaced.competition?.iconMediaId === 'icon-b.png')
  const cleared = await updateCompetition(actor, id, { iconMediaId: null })
  check('removes an icon (back to initials)', cleared.competition?.iconMediaId === null)

  console.log('\n--- Activate / deactivate ---')
  await updateCompetition(actor, id, { active: false })
  const activeSlugs = (await listActiveCompetitions()).map((c) => c.slug)
  check('inactive Competitions leave the active list', !activeSlugs.includes('vcs'))
  const adminRows = await listCompetitionsForAdmin()
  check('but remain visible to staff', adminRows.some((r) => r.slug === 'vcs'))
  check('staff rows carry a Season count', adminRows.every((r) => Number.isInteger(r.seasonCount)))
  const inactiveSeason = await createSeason(actor, { competitionSeriesId: id, lounge: 'Social', accessMode: 'OPEN' })
  check('a Season cannot be created under an INACTIVE Competition', !inactiveSeason.ok, inactiveSeason.error)
  await updateCompetition(actor, id, { active: true })

  console.log('\n--- Season ownership is required ---')
  const noOwner = await createSeason(actor, { lounge: 'Social', accessMode: 'OPEN' })
  check('rejects a Season with no Competition', !noOwner.ok, noOwner.error)
  const ghost = await createSeason(actor, { competitionSeriesId: 999999, lounge: 'Social', accessMode: 'OPEN' })
  check('rejects a Season pointing at a missing Competition', !ghost.ok, ghost.error)

  console.log('\n--- Delete guard ---')
  const owned = await createSeason(actor, { competitionSeriesId: id, lounge: 'Social', accessMode: 'OPEN' })
  check('creates a Season under the Competition', owned.ok === true, owned.error)
  const blocked = await deleteCompetition(actor, id)
  check('refuses to delete a Competition that owns Seasons', !blocked.ok, blocked.error)
  check('the refusal explains why', /owns \d+ Season/.test(blocked.error ?? ''))

  // Remove the Season, then the Competition should delete cleanly.
  if (owned.number != null) {
    const season = await prisma.season.findUnique({ where: { number: owned.number }, select: { id: true } })
    if (season) await prisma.season.delete({ where: { id: season.id } })
  }
  const freed = await deleteCompetition(actor, id)
  check('deletes once no Seasons remain', freed.ok === true, freed.error)
  if (freed.ok) made.pop()

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

main()
  .catch((e) => { console.error(e); fail++ })
  .finally(async () => {
    for (const id of made) await prisma.competitionSeries.delete({ where: { id } }).catch(() => {})
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
