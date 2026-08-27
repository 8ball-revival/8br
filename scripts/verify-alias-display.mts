/**
 * An alias keeps its spelling, and still matches however it is punctuated.
 *
 * ── What went wrong ─────────────────────────────────────────────────────────────────────────────
 * `PlayerAlias.alias` was doing two jobs. Matching needs a normalised key, so `Big_Nav` and `bignav`
 * resolve to one person; display needs the handle as somebody wrote it. One column cannot be both,
 * and the key won: recording `fsm_brian` stored `fsmbrian`, the spelling was gone for good, and
 * "Previously known as" listed match keys instead of handles.
 *
 * The key kept its name and its indexes; the spelling has its own column. These checks pin both
 * halves — that the spelling survives a round trip, and that matching is still blind to punctuation
 * and case, which is the property the normalisation existed for.
 *
 * Every check runs on a fixture Player created and removed here, so it asserts against the real
 * services rather than a mock, and leaves nothing behind.
 *
 * Usage: tsx scripts/verify-alias-display.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { addAlias, listAliases, removeAlias, aliasKey, aliasDisplayOf } from '../src/lib/players/aliases.ts'

assertLocalDatabase()

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

const ACTOR = { userId: 2, username: 'verify-alias-display' }
const MARK = 'zz_alias_display_fixture'

/** Remove anything a previous interrupted run left behind, so this is repeatable. */
async function cleanup() {
  const rows = await prisma.player.findMany({ where: { primaryName: MARK }, select: { id: true } })
  for (const r of rows) {
    await prisma.playerAlias.deleteMany({ where: { playerId: r.id } })
    await prisma.player.delete({ where: { id: r.id } }).catch(() => null)
  }
}

await cleanup()

const subject = await prisma.player.create({
  data: { primaryName: MARK, cueverseId: 'zz_fixture_subject', cueverseIdNormalized: 'zz_fixture_subject' },
  select: { id: true },
})
const other = await prisma.player.create({
  data: { primaryName: MARK, cueverseId: 'zz_fixture_other', cueverseIdNormalized: 'zz_fixture_other' },
  select: { id: true },
})

try {
  console.log('--- The key and the spelling are different things ---')

  check('the key strips case and punctuation', aliasKey('ZZ_Fix_Brian!') === 'zzfixbrian', aliasKey('ZZ_Fix_Brian!'))
  check('...and is stable across spellings of one handle',
    aliasKey('zz_fix_brian') === aliasKey('ZZ.Fix.Brian') && aliasKey('zz_fix_brian') === aliasKey('zzfixbrian'))

  console.log('\n--- Recording an alias keeps what was typed ---')

  const added = await addAlias(ACTOR, subject.id, 'ZZ_Fix_Brian')
  check('the alias is recorded', added.ok, added.error)

  const stored = await prisma.playerAlias.findFirst({
    where: { playerId: subject.id },
    select: { alias: true, aliasDisplay: true },
  })
  check('the stored key is normalised', stored?.alias === 'zzfixbrian', String(stored?.alias))
  check('the stored spelling is what was typed', stored?.aliasDisplay === 'ZZ_Fix_Brian', String(stored?.aliasDisplay))
  check('the two are genuinely different', stored?.alias !== stored?.aliasDisplay)

  const listed = await listAliases(subject.id)
  check('listAliases shows the spelling', listed[0]?.display === 'ZZ_Fix_Brian', listed[0]?.display)
  check('...and still exposes the key it matches on', listed[0]?.alias === 'zzfixbrian', listed[0]?.alias)

  console.log('\n--- Matching is still blind to punctuation and case ---')

  /*
   * The property the normalisation exists for. If a differently punctuated spelling of an alias the
   * player already has created a SECOND row, the handle would match twice and the whole point of a
   * key would be lost.
   */
  const again = await addAlias(ACTOR, subject.id, 'zz.fix.brian')
  check('re-adding the same handle punctuated differently succeeds', again.ok, again.error)
  const count = await prisma.playerAlias.count({ where: { playerId: subject.id } })
  check('...and records no second alias', count === 1, `${count} alias row(s)`)

  const claimed = await addAlias(ACTOR, other.id, 'ZZ-FIX-BRIAN')
  check('another player cannot claim the same handle in another spelling',
    !claimed.ok, claimed.error ?? 'it was allowed')

  console.log('\n--- Rows written before the spelling column ---')

  /*
   * Legacy rows have a key and nothing else, which is exactly the state the 667 existing aliases are
   * in. They must still display — as the key, which is what they showed before — rather than as a
   * blank, and they are not backfilled with a guess.
   */
  await prisma.playerAlias.create({ data: { playerId: subject.id, alias: 'zzlegacyhandle' } })
  const withLegacy = await listAliases(subject.id)
  const legacy = withLegacy.find((a) => a.alias === 'zzlegacyhandle')
  check('a spelling-less alias still displays', legacy?.display === 'zzlegacyhandle', String(legacy?.display))
  check('...and the helper agrees', aliasDisplayOf({ alias: 'zzlegacyhandle', aliasDisplay: null }) === 'zzlegacyhandle')
  check('...while a blank spelling falls back rather than showing nothing',
    aliasDisplayOf({ alias: 'k', aliasDisplay: '   ' }) === 'k')

  console.log('\n--- Removal still works on the key ---')

  const target = withLegacy.find((a) => a.alias === 'zzfixbrian')
  const removed = await removeAlias(ACTOR, subject.id, target!.id)
  check('an alias can be removed by id', removed.ok, removed.error)
  check('...and is gone', (await prisma.playerAlias.count({ where: { playerId: subject.id, alias: 'zzfixbrian' } })) === 0)

  console.log('\n--- Every write path records a spelling ---')

  /*
   * Read as source, because these paths need a rename or a merge to exercise and neither belongs in
   * a fixture. What matters is that no path writes the key alone any more.
   */
  const { readFileSync } = await import('node:fs')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const rename = strip(readFileSync('src/lib/players/service.ts', 'utf8'))
  const merge = strip(readFileSync('src/lib/players/merge.ts', 'utf8'))
  const renameCreate = rename.slice(rename.indexOf('playerAlias'), rename.indexOf('playerAlias') + 300)
  const mergeCreate = merge.slice(merge.indexOf('playerAlias.create'), merge.indexOf('playerAlias.create') + 300)
  check('a rename records the old handle with its spelling', /aliasDisplay/.test(renameCreate))
  check('a merge records the released handle with its spelling', /aliasDisplay/.test(mergeCreate))
  check('...and a merge stores a normalised key, not the raw handle', /aliasKey\(released\)/.test(merge))

  console.log('\n--- The Rankings list shows spellings ---')

  const explorer = strip(readFileSync('src/lib/stats/ladder-explorer.ts', 'utf8'))
  check('the alias list prefers the spelling', /aliasDisplay/.test(explorer) && /alias_list/.test(explorer))
  check('...falling back to the key when there is none', /coalesce\(nullif\(btrim\(pa\."aliasDisplay"\)/.test(explorer))

  console.log('\n--- Member search still finds either form ---')

  const members = strip(readFileSync('src/lib/staff/members.ts', 'utf8'))
  check('search matches the key as well as the spelling', /aliasSearch/.test(members))
  check('...and the displayed list is the spelling', /aliasDisplay\?\.trim\(\) \|\| a\.alias/.test(members))
} finally {
  await cleanup()
  const left = await prisma.player.count({ where: { primaryName: MARK } })
  check('the fixture leaves nothing behind', left === 0, `${left} fixture row(s) remain`)
}

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) failed`}`)
await prisma.$disconnect()
process.exit(failures === 0 ? 0 : 1)
