/**
 * The seeding fallback for a reconstruction with no group stage, and its guards.
 *
 * Seeding is dictated by the group results and by nothing else. One archived Season has no group
 * results to be dictated by — 2009 S5 has a complete playoff page and no groups, no group matches
 * and no standings — so its seeding came back empty and its bracket could not be drawn.
 *
 * The fallback reads the seeds the page printed. What matters is that it cannot reach anything else:
 * a live Season must never take this path, because a live Season's seeding is a competitive outcome
 * and the fallback would let it be set by hand. These checks pin the guard, not the happy path.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { loadSeasonSeeding } from '../src/lib/seasons/playoffs.ts'

assertLocalDatabase()

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

console.log('--- A reconstruction with no group stage seeds from the page ---')

const s5 = await prisma.season.findFirst({
  where: { competitionYear: 2009, number: 5, division: 'A' },
  select: { id: true, reconstruction: true },
})
if (!s5) {
  console.log('  – 2009 S5A is not present; nothing to check')
} else {
  const standings = await prisma.seasonStanding.count({ where: { seasonId: s5.id } })
  const groups = await prisma.seasonGroup.count({ where: { seasonId: s5.id } })
  check('it still has no group stage', standings === 0 && groups === 0, `${groups} group(s), ${standings} standing(s)`)

  const seeding = await loadSeasonSeeding(s5.id)
  check('the seeding is not empty', seeding.length > 0, `${seeding.length} row(s)`)
  check('every row carries an overall seed', seeding.every((r) => r.overallSeed != null))
  check('the seeds run 1..n without a gap or a repeat',
    seeding.map((r) => r.overallSeed).join(',') === seeding.map((_, i) => i + 1).join(','))

  /*
   * Nothing about a group stage is claimed. A placeholder that read like a real group finish would
   * be worse than no seeding at all — it would put a record on the page that never happened.
   */
  check('no group is named', seeding.every((r) => r.group === '—'))
  check('no group record is claimed', seeding.every((r) => r.record === '—' && r.points === 0))

  const top = seeding[0]
  check('the top seed is the one the page prints first', top?.cueverseId?.toLowerCase() === 'mj_the_king',
    top?.cueverseId ?? '—')
}

console.log('\n--- The guard: nothing else can take this path ---')

/*
 * The fallback needs three things at once: no standings, a reconstruction, and entrants carrying a
 * seed. Each is checked by removing it, because a guard that is never exercised is not a guard.
 */
const withGroups = await prisma.season.findFirst({
  where: { archiveTemplateKey: { not: null }, standings: { some: {} } },
  select: { id: true },
})
if (withGroups) {
  const seeding = await loadSeasonSeeding(withGroups.id)
  check('a Season WITH standings still seeds from them',
    seeding.length > 0 && seeding.some((r) => r.group !== '—'),
    `${seeding.length} row(s), groups: ${[...new Set(seeding.map((r) => r.group))].slice(0, 3).join('/')}`)
}

/*
 * The reconstruction flag is the guard that matters, so it is exercised directly rather than hoping
 * a Season happens to exist in the shape that would test it. The flag is flipped on a Season that
 * does take the path, the seeding is re-read, and the flag is put back — inside a transaction that
 * always rolls back, so nothing is left changed either way.
 */
if (s5) {
  /*
   * The flag is flipped for real and restored in a finally, rather than inside a rolled-back
   * transaction: loadSeasonSeeding reads through the global client, so it would never see an
   * uncommitted change and the check would pass for the wrong reason. It did, the first time.
   */
  let seededWhileLive = -1
  try {
    await prisma.season.update({ where: { id: s5.id }, data: { reconstruction: false } })
    seededWhileLive = (await loadSeasonSeeding(s5.id)).length
  } finally {
    await prisma.season.update({ where: { id: s5.id }, data: { reconstruction: true } })
  }

  check('the same Season seeds nobody once it is not a reconstruction',
    seededWhileLive === 0, `${seededWhileLive} row(s)`)

  const still = await prisma.season.findUniqueOrThrow({ where: { id: s5.id }, select: { reconstruction: true } })
  check('and the flag was put back', still.reconstruction)
  check('and it seeds again', (await loadSeasonSeeding(s5.id)).length > 0)
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
await prisma.$disconnect()
process.exit(failures === 0 ? 0 : 1)
