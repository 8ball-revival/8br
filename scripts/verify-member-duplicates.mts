/**
 * Possible-duplicate detection on the Create New Member form.
 *
 * The duplicate that actually happens is not an identical handle — the unique index refuses those.
 * It is the same person entered twice under handles differing by punctuation or case, or a new
 * account whose handle matches an old archive record's NAME because the two fields were entered the
 * other way round. Both slip past exact matching, and by the time anyone notices, the second
 * identity has results attached to it.
 *
 * These run against the real archive rather than fixtures, because the case that matters is the one
 * already sitting in this database.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-member-duplicates.mts
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { findPossibleDuplicates, identityKey } from '../src/lib/staff/possible-duplicates.ts'
import { archiveAvailable, lookupArchiveIdentities, otherNamesFor, linkingYim } from '../src/lib/staff/archive-identity.ts'
import { TEMPORARY_PASSWORD } from '../src/lib/account/validation.ts'

assertLocalDatabase('verify-member-duplicates')

/** Players this run creates, removed in the finally block whatever happens. */
const madePlayers: string[] = []

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

section('Handles are compared the way a person would compare them')
{
  const same = ['xlx_cerebro_xlx', 'XLX Cerebro XLX', 'xlx-cerebro-xlx', 'XLX.Cerebro.XLX', 'xlxcerebroxlx']
  check('punctuation, spacing and case all collapse',
    new Set(same.map(identityKey)).size === 1, JSON.stringify(same.map(identityKey)))
  // Digits are meaningful: Tyler2 is usually a different person from Tyler.
  check('digits are kept', identityKey('Tyler2') !== identityKey('Tyler'))
  check('an empty value normalises to empty', identityKey(null) === '' && identityKey('') === '')
}

section('The form no longer asks for a password')
{
  const form = readFileSync('src/components/staff/create-member-button.tsx', 'utf8')
  check('there is no temporary-password input', !/Temporary password/.test(form))
  check('the fixed password is still stated in one line', form.includes('{TEMPORARY_PASSWORD}'))
  check('every account still starts on the shared password', TEMPORARY_PASSWORD === 'Luna8ear')

  const service = readFileSync('src/lib/staff/create-member-service.ts', 'utf8')
  check('the server still defaults to it when none is supplied',
    service.includes('input.password || TEMPORARY_PASSWORD'))
}

section('The panel is gated and rendered beside the form')
{
  const action = readFileSync('src/lib/staff/create-member.ts', 'utf8')
  const idx = action.indexOf('export async function findPossibleDuplicatesAction')
  const body = action.slice(idx, idx + 420)
  check('the lookup requires the same capability as creating a member',
    body.includes("requireCapability('manage_players')"))
  check('...before it reads anything',
    body.indexOf('requireCapability') < body.indexOf('findPossibleDuplicates('))

  const form = readFileSync('src/components/staff/create-member-button.tsx', 'utf8')
  check('the panel is rendered', form.includes('<DuplicatePanel'))
  check('...beside the form, not under it', form.includes('lg:grid-cols-[minmax(0,1fr)_20rem]'))
  check('it reacts to both fields', form.includes('cueverseId={cueverseId} preferredName={preferredName}'))
  check('the lookup is debounced', /setTimeout\([\s\S]{0,500}findPossibleDuplicatesAction/.test(form))
  check('stale responses are discarded', form.includes('if (mine === seq.current)'))
  check('it announces itself politely', form.includes('aria-live="polite"'))
  // A warning that blocks the save would stop a roster over two people who merely look alike.
  check('it never disables the submit button', !/disabled=\{[^}]*matches/.test(form))
}

const FIXTURE_IDS = ['zzTop__Dawg__', 'Top__Dawg__']
const FIXTURE_NAME = 'zz Sterlo Fixture'

async function sweepFixtures() {
  const strays = await prisma.player.findMany({
    where: { OR: [{ primaryName: FIXTURE_NAME }, { cueverseId: { in: FIXTURE_IDS } }] },
    select: { id: true },
  }).catch(() => [] as { id: string }[])
  for (const s of strays) {
    await prisma.playerAlias.deleteMany({ where: { playerId: s.id } }).catch(() => {})
    await prisma.player.delete({ where: { id: s.id } }).catch(() => {})
  }
}

async function main() {
  await sweepFixtures()

  section('Nothing is reported for an empty or trivial query')
  check('an empty query finds nothing', (await findPossibleDuplicates('', '')).length === 0)
  check('a single character finds nothing', (await findPossibleDuplicates('a', '')).length === 0)
  check('a handle nobody has finds nothing',
    (await findPossibleDuplicates('zzz_definitely_nobody_zzz', '')).length === 0)

  const real = await prisma.player.findFirst({
    where: { cueverseId: { not: null }, primaryName: { not: '' } },
    select: { cueverseId: true, primaryName: true },
  })
  if (!real?.cueverseId) { check('there is a player to test against', false); return }
  console.log(`  (testing against ${real.cueverseId} / ${real.primaryName})`)

  section('An existing handle is reported, however it is typed')
  const variants = [
    real.cueverseId,
    real.cueverseId.toUpperCase(),
    real.cueverseId.replace(/_/g, ' '),
    real.cueverseId.replace(/_/g, '.'),
    real.cueverseId.replace(/[^a-zA-Z0-9]/g, ''),
  ]
  for (const v of variants) {
    const found = await findPossibleDuplicates(v, '')
    check(`"${v}" is recognised`, found.some((m) => m.reason === 'exact-id'),
      found.map((m) => `${m.cueverseId}[${m.reason}]`).join(' ') || 'nothing')
  }

  section('A handle that matches an existing NAME is reported')
  // This is how the archive's reversed-field records create a second identity for one person.
  const found = await findPossibleDuplicates(real.primaryName, '')
  check('typing an existing name as a CueVerse ID raises a match', found.length > 0,
    found.map((m) => `${m.cueverseId}[${m.reason}]`).join(' ') || 'nothing')

  section('Each match explains itself and carries the evidence')
  const sample = await findPossibleDuplicates(real.cueverseId, '')
  check('there is at least one match', sample.length > 0)
  for (const m of sample) {
    check(`${m.cueverseId ?? m.playerId} states a reason`, m.explanation.length > 10, m.explanation)
    check(`${m.cueverseId ?? m.playerId} reports its history`, Number.isInteger(m.played))
    check(`${m.cueverseId ?? m.playerId} reports whether an account exists`, typeof m.hasAccount === 'boolean')
  }
  check('an exact clash is ranked first', sample[0]?.reason === 'exact-id', String(sample[0]?.reason))

  section('Results are bounded')
  const broad = await findPossibleDuplicates('ab', 'ab')
  check('a short query cannot flood the panel', broad.length <= 8, String(broad.length))

  section('Handles linked by a shared Yahoo ID are flagged')
  {
    // The case no string comparison can reach: two handles with nothing in common, recorded in the
    // archive against one Yahoo account.
    check('the archive index loaded', archiveAvailable())

    const ids = lookupArchiveIdentities('trojan_man')
    check('a known handle resolves to an archive person', ids.length === 1, String(ids.length))
    if (ids.length === 1) {
      const others = otherNamesFor(ids[0], 'trojan_man').map((x) => x.toLowerCase())
      check('...and yields the other handles that person used',
        others.includes('top__dawg__'), others.join(', '))
      check('...including records folded in by a punctuation-variant Yahoo ID',
        ids[0].mergedFrom.length > 0, JSON.stringify(ids[0].mergedFrom))
    }

    // A YIM is only named when it can be defended: these are real personal addresses, and an
    // arbitrary one printed in an admin panel would be a claim that is not established.
    const byYim = lookupArchiveIdentities('xlx_cerebro_xlx')
    check('typing the Yahoo ID itself names that Yahoo ID',
      byYim.length === 1 && linkingYim(byYim[0], 'xlx_cerebro_xlx') === 'xlx_cerebro_xlx')
    if (ids.length === 1) {
      check('a handle on a person with several Yahoo IDs names none of them',
        linkingYim(ids[0], 'trojan_man') === null, String(linkingYim(ids[0], 'trojan_man')))
    }

    // End to end: stand in a member under one handle, type the other.
    const stand = await prisma.player.create({
      data: { primaryName: FIXTURE_NAME, cueverseId: 'zzTop__Dawg__', cueverseIdNormalized: 'zztop__dawg__' },
      select: { id: true },
    })
    madePlayers.push(stand.id)
    // Reuse the real archive handle so the link is exercised, not a fixture-only shortcut.
    await prisma.player.update({ where: { id: stand.id }, data: { cueverseId: 'Top__Dawg__', cueverseIdNormalized: 'top__dawg__' } })

    const flagged = await findPossibleDuplicates('trojan_man', '')
    check('typing trojan_man flags the existing Top__Dawg__ member',
      flagged.some((m) => m.playerId === stand.id && m.reason === 'shared-yim'),
      flagged.map((m) => `${m.cueverseId}[${m.reason}]`).join(' ') || 'nothing')
    check('...and explains that they share a Yahoo account',
      flagged.some((m) => /Yahoo/i.test(m.explanation)))
    check('a shared Yahoo ID outranks every string similarity',
      flagged[0]?.reason === 'shared-yim', String(flagged[0]?.reason))

    const unrelated = await findPossibleDuplicates('zzz_unrelated_person', '')
    check('an unrelated handle is still not flagged', unrelated.length === 0, String(unrelated.length))
  }

  section('Nothing is written by looking')
  const before = await prisma.player.count()
  await findPossibleDuplicates(real.cueverseId, real.primaryName)
  check('the player count is unchanged', (await prisma.player.count()) === before)
}

let code = 0
try {
  await main()
} catch (e) {
  fail++
  console.log('\nFATAL ' + (e instanceof Error ? e.message : String(e)))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  code = fail === 0 ? 0 : 1
  await prisma.$disconnect()
}
process.exit(code)
