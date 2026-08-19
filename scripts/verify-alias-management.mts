/**
 * Aliases: recorded on every rename, managed by hand, and never ambiguous.
 *
 * An alias is what keeps somebody findable under a handle they no longer use — search, entrant
 * matching and archive reconciliation all consult them. Two properties matter and neither is
 * visible from the screen:
 *
 *   1. A rename records the old handle AUTOMATICALLY, from wherever it was made. If that only
 *      happened on one of the two paths, half of all renames would silently strand everyone who
 *      knew the player by their previous name.
 *   2. One handle never points at two players. An alias claimed by somebody else makes every
 *      lookup that uses it ambiguous, and the resulting mis-match is far harder to find later than
 *      an error message at the point of entry.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-alias-management.mts
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { addAlias, removeAlias, listAliases, aliasKey } from '../src/lib/players/aliases.ts'

assertLocalDatabase('verify-alias-management')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const actor = { userId: 990902, username: 'verify' }
const FIXTURE_A = 'zzaliasfixture'
const FIXTURE_B = 'zzaliasfixture2'
const madePlayers: string[] = []

async function cleanup() {
  for (const id of madePlayers) {
    await prisma.playerAlias.deleteMany({ where: { playerId: id } }).catch(() => {})
    await prisma.player.delete({ where: { id } }).catch(() => {})
  }
  madePlayers.length = 0
  await prisma.auditLog.deleteMany({ where: { actorUsername: actor.username } }).catch(() => {})
}

section('Aliases are stored the way they are matched')
{
  const same = ['Big_Nav', 'BIG NAV', 'big.nav', 'big-nav', 'bignav']
  check('punctuation, spacing and case all collapse to one key',
    new Set(same.map(aliasKey)).size === 1, JSON.stringify(same.map(aliasKey)))
  check('digits survive', aliasKey('Tyler2') === 'tyler2')
  check('an empty handle normalises to empty', aliasKey('   ') === '')
}

section('Every rename path goes through one function')
{
  // Only `changeCueverseId` writes the column. If a second writer appeared, a rename made through
  // it would leave no alias behind and nobody would notice until a search stopped working.
  const service = readFileSync('src/lib/players/service.ts', 'utf8')
  check('the rename records the previous handle as an alias',
    /playerAlias\s*\n?\s*\.create\(\{ data: \{ playerId: profileId, alias: aliasKey \} \}\)/.test(service)
    || service.includes('.create({ data: { playerId: profileId, alias: aliasKey } })'))
  check('...only once the login sync has succeeded',
    service.indexOf('Compensating rollback') < service.indexOf('playerAlias'))
  check('...and not for a case-only recasing', service.includes('if (!caseOnly && oldKey)'))

  const admin = readFileSync('src/lib/staff/member-profile-actions.ts', 'utf8')
  check('the admin path renames through it', admin.includes('changeCueverseId('))
  const self = readFileSync('src/lib/account/actions.ts', 'utf8')
  check('the member self-service path renames through it', self.includes('changeCueverseId('))
}

section('The list offers quick-add; the profile offers full management')
{
  const row = readFileSync('src/components/staff/member-row-editor.tsx', 'utf8')
  check('the roster row can add an alias', row.includes('addAliasAction'))
  // Removing an alias can break a lookup that currently works — not a call to make from a table.
  check('...but cannot remove one', !row.includes('removeAliasAction'))

  const manager = readFileSync('src/components/staff/alias-manager.tsx', 'utf8')
  check('the member page can add', manager.includes('addAliasAction'))
  check('...and remove', manager.includes('removeAliasAction'))
  check('...with a labelled remove control per alias', manager.includes('Remove the alias ${a.alias}'))

  const detail = readFileSync('src/app/(frontend)/staff/members/[userId]/page.tsx', 'utf8')
  check('the manager is mounted on the member page', detail.includes('<AliasManager'))

  const actions = readFileSync('src/lib/players/alias-actions.ts', 'utf8')
  check('adding is capability-gated', /addAliasAction[\s\S]{0,220}requireCapability\('manage_players'\)/.test(actions))
  check('removing is capability-gated', /removeAliasAction[\s\S]{0,220}requireCapability\('manage_players'\)/.test(actions))
}

section('Deleted accounts are out of the default roster')
{
  const members = readFileSync('src/lib/staff/members.ts', 'utf8')
  check('deleted rows are filtered out unless asked for',
    members.includes("opts.status === 'DELETED' ? r.status === 'DELETED' : r.status !== 'DELETED'"))
}

async function main() {
  await cleanup()

  const a = await prisma.player.create({
    data: { primaryName: 'ZZ Alias Fixture', cueverseId: FIXTURE_A, cueverseIdNormalized: FIXTURE_A },
    select: { id: true },
  })
  madePlayers.push(a.id)
  const b = await prisma.player.create({
    data: { primaryName: 'ZZ Alias Fixture 2', cueverseId: FIXTURE_B, cueverseIdNormalized: FIXTURE_B },
    select: { id: true },
  })
  madePlayers.push(b.id)

  section('Adding an alias')
  check('a new alias is recorded', (await addAlias(actor, a.id, 'ZZ Old Handle')).ok)
  check('...normalised', (await listAliases(a.id)).some((x) => x.alias === 'zzoldhandle'))
  check('re-adding the same alias is harmless', (await addAlias(actor, a.id, 'zz.old.handle')).ok)
  check('...and does not duplicate it',
    (await listAliases(a.id)).filter((x) => x.alias === 'zzoldhandle').length === 1)

  section('What is refused')
  check('an empty handle is refused', !(await addAlias(actor, a.id, '   ')).ok)
  check('their own CueVerse ID is refused', !(await addAlias(actor, a.id, FIXTURE_A)).ok)
  check('an over-long handle is refused', !(await addAlias(actor, a.id, 'x'.repeat(80))).ok)
  check('a player that does not exist is refused', !(await addAlias(actor, 'nope', 'whatever')).ok)

  // The important one: one handle cannot point at two people.
  const stolen = await addAlias(actor, b.id, 'zzoldhandle')
  check('an alias already claimed by another player is refused', !stolen.ok)
  check('...naming who holds it', (stolen.error ?? '').includes(FIXTURE_A), stolen.error ?? '')
  check('...and the original keeps it', (await listAliases(a.id)).some((x) => x.alias === 'zzoldhandle'))
  check('...while the other gains nothing', (await listAliases(b.id)).length === 0)

  section('Removing an alias')
  const rows = await listAliases(a.id)
  const target = rows.find((x) => x.alias === 'zzoldhandle')!
  check('an alias cannot be removed through the wrong player',
    !(await removeAlias(actor, b.id, target.id)).ok)
  check('...and survives the attempt', (await listAliases(a.id)).some((x) => x.id === target.id))
  check('the owner can remove it', (await removeAlias(actor, a.id, target.id)).ok)
  check('...and it is gone', !(await listAliases(a.id)).some((x) => x.id === target.id))
  check('removing it twice is refused rather than silent',
    !(await removeAlias(actor, a.id, target.id)).ok)

  section('Both changes are audited')
  const audit = await prisma.auditLog.findMany({
    where: { actorUsername: actor.username, action: { startsWith: 'player.alias' } },
    select: { action: true, entityId: true },
  })
  check('adding is audited', audit.some((x) => x.action === 'player.alias.add'))
  check('removing is audited', audit.some((x) => x.action === 'player.alias.remove'))
  check('...against the player it happened to', audit.every((x) => x.entityId === a.id))
}

let code = 0
try {
  await main()
} catch (e) {
  fail++
  console.log('\nFATAL ' + (e instanceof Error ? e.message : String(e)))
} finally {
  await cleanup()
  const left = await prisma.player.count({ where: { cueverseId: { in: [FIXTURE_A, FIXTURE_B] } } }).catch(() => -1)
  check('fixtures cleaned up', left === 0, String(left))
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  code = fail === 0 ? 0 : 1
  await prisma.$disconnect()
}
process.exit(code)
