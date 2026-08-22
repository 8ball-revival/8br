/**
 * The site-wide naming rule: the CueVerse ID leads, the preferred name follows only when it adds
 * something. Pins `@/lib/identity/display` and the older `formatIdentityLabel` that now delegates
 * to it, so the two can never drift back apart. Pure functions — nothing to clean up.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-identity-display.mts
 */
import {
  identityLines, identityText, fromNameHandle, fromDisplayName, matchesIdentity, NO_IDENTITY,
} from '../src/lib/identity/display.ts'
import { formatIdentityLabel, resolvePublicIdentity } from '../src/lib/identity/public-identity.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}

console.log('--- The CueVerse ID leads, and is never the half that gets dropped ---')
/*
 * This order is the reverse of what it was.
 *
 * Leading with the handle made every roster, bracket and table read like a list of logins. The name
 * leads now — but the handle is never dropped to make room, because a Preferred Name on its own
 * does not identify a competitor.
 */
{
  const l = identityLines({ cueverseId: 'drummer_dude', preferredName: 'Mike' })
  check('the CueVerse ID is the primary line', l.primary === 'drummer_dude', l.primary)
  check('the preferred name is the secondary line', l.secondary === 'Mike', String(l.secondary))
  check('one-line form reads "ID · Name"',
    identityText({ cueverseId: 'drummer_dude', preferredName: 'Mike' }) === 'drummer_dude · Mike')
}

console.log('')
console.log('--- Two players sharing a preferred name stay distinguishable ---')
{
  // The case that motivated this: Season 1 has two Mikes in one group, and several Chis across the
  // years. Their rendered identities must differ.
  const a = identityText({ cueverseId: 'drummer_dude', preferredName: 'Mike' })
  const b = identityText({ cueverseId: 'xlx_darkforce_xlx', preferredName: 'Mike' })
  check('same preferred name, different rendered identity', a !== b, `${a} vs ${b}`)
  check('...because each leads with its own ID', a.startsWith('drummer_dude') && b.startsWith('xlx_darkforce_xlx'))
  check('...and neither is reduced to the shared name', a !== 'Mike' && b !== 'Mike')
}

console.log('')
console.log('--- The preferred name is dropped when it adds nothing ---')
{
  check('an identical name is not repeated',
    identityLines({ cueverseId: 'xlx_propooler_xlx', preferredName: 'xlx_propooler_xlx' }).secondary === null)
  check('case differences do not count as a distinct name',
    identityLines({ cueverseId: 'Starkiller', preferredName: 'starkiller' }).secondary === null)
  check('surrounding whitespace does not count either',
    identityLines({ cueverseId: 'l3ammy', preferredName: '  l3ammy  ' }).secondary === null)
  check('one-line form is just the ID then',
    identityText({ cueverseId: 'l3ammy', preferredName: 'l3ammy' }) === 'l3ammy')
}

console.log('')
console.log('--- Falling back when half the identity is missing ---')
{
  check('no preferred name → the ID alone',
    identityLines({ cueverseId: 'mtvaldo', preferredName: null }).primary === 'mtvaldo' &&
    identityLines({ cueverseId: 'mtvaldo', preferredName: null }).secondary === null)
  check('no CueVerse ID → the preferred name is promoted',
    identityLines({ cueverseId: null, preferredName: 'Aldo' }).primary === 'Aldo')
  check('a promoted name never trails itself',
    identityLines({ cueverseId: null, preferredName: 'Aldo' }).secondary === null)
  check('an empty ID counts as missing',
    identityLines({ cueverseId: '   ', preferredName: 'Aldo' }).primary === 'Aldo')
  check('neither → a placeholder, not an empty string',
    identityLines({ cueverseId: null, preferredName: null }).primary === NO_IDENTITY)
  check('null input is handled', identityLines(null).primary === NO_IDENTITY)
}

console.log('')
console.log('--- The shape adapters read the fields the app actually stores ---')
{
  check('{ name, handle } maps handle → ID',
    identityText(fromNameHandle({ name: 'CK', handle: 'aka_chris_soccer' })) === 'aka_chris_soccer · CK')
  check('{ displayName, cueverseId } maps displayName → preferred name',
    identityText(fromDisplayName({ displayName: 'Luis', cueverseId: 'xlx_cerebro_xlx' })) === 'xlx_cerebro_xlx · Luis')
  check('a slot with neither half is still safe', identityText(fromNameHandle(null)) === NO_IDENTITY)
}

console.log('')
console.log('--- Search matches either half ---')
{
  const mike = { cueverseId: 'drummer_dude', preferredName: 'Mike' }
  check('typing the preferred name finds them', matchesIdentity(mike, 'mike'))
  check('typing the ID finds them', matchesIdentity(mike, 'drummer'))
  check('a partial match works', matchesIdentity(mike, 'DUDE'))
  check('an unrelated query does not match', !matchesIdentity(mike, 'aldo'))
  check('an empty query matches everything', matchesIdentity(mike, '   '))
}

console.log('')
console.log('--- The legacy formatter now agrees with the shared rule ---')
{
  check('formatIdentityLabel leads with the ID',
    formatIdentityLabel('Mike', 'drummer_dude') === 'drummer_dude · Mike')
  check('it drops a duplicate name', formatIdentityLabel('l3ammy', 'l3ammy') === 'l3ammy')
  check('it falls back to the name with no ID', formatIdentityLabel('Aldo', null) === 'Aldo')
  check('it still says "Unknown" when there is nothing', formatIdentityLabel('', null) === 'Unknown')

  const r = resolvePublicIdentity({ preferredName: 'CK', cueverseId: 'aka_chris_soccer', slug: 'aka_chris_soccer' })
  check('resolvePublicIdentity builds the same label', r.label === 'aka_chris_soccer · CK', r.label)
  check('it keeps the profile slug', r.slug === 'aka_chris_soccer')
}

console.log('')
console.log('--- The CueVerse ID is present everywhere, always ---')
/*
 * The failure this guards against is silent: a surface renders `primary` alone, it looks fine on a
 * roster where everyone has a distinct name, and it stops identifying anybody the moment two people
 * share one. Whenever a CueVerse ID exists, both halves must be available to render.
 */
{
  const withBoth = identityLines({ cueverseId: 'drummer_dude', preferredName: 'Mike' })
  check('the ID is the line every caller renders', withBoth.primary === 'drummer_dude')
  check('...so a surface with room for one line still shows it', withBoth.primary.includes('drummer_dude'))
  check('...and the one-line form contains both halves',
    identityText({ cueverseId: 'drummer_dude', preferredName: 'Mike' }).includes('Mike') &&
    identityText({ cueverseId: 'drummer_dude', preferredName: 'Mike' }).includes('drummer_dude'))

  const nameOnly = identityLines({ preferredName: 'Aldo' })
  check('a player with no ID falls back to the name', nameOnly.primary === 'Aldo')
  check('...with nothing invented underneath it', nameOnly.secondary === null)

  const idOnly = identityLines({ cueverseId: 'l3ammy' })
  check('a player with no Preferred Name shows the ID alone', idOnly.primary === 'l3ammy')
  check('...and does not repeat it underneath', idOnly.secondary === null)

  const same = identityLines({ cueverseId: 'l3ammy', preferredName: 'l3ammy' })
  check('a name identical to the ID is not printed twice', same.secondary === null)
  check('...case-insensitively', identityLines({ cueverseId: 'L3ammy', preferredName: 'l3ammy' }).secondary === null)
}


console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
