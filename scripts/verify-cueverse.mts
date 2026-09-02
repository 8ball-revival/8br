/**
 * The CueVerse adapter: their links, their numbers, and one request per read.
 *
 * ── Two halves, deliberately ────────────────────────────────────────────────────────────────────
 * The parsing and the link building run against a RECORDED response, so the suite says the same
 * thing on a train and cannot fail because somebody else's server is down. One small section at the
 * end does touch the live endpoint, because the thing most likely to break this integration is
 * CueVerse changing its shape, and a suite that could never notice that would be false comfort.
 *
 * The live section is skipped, not failed, when there is no network. It is a canary, not a gate.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/verify-cueverse.mts
 */
import {
  CUEVERSE_ORIGIN, cueverseProfileUrl, cueverseReplayUrl, formatStreak, opponentParts, ordinal, resultLabel,
} from '../src/lib/cueverse/links.ts'
import { GAME_LIMIT, getCueverseProfile, normalizeProfile } from '../src/lib/cueverse/profile.ts'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0, skipped = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const skip = (label: string, why: string) => { skipped++; console.log(`  – ${label} (${why})`) }
const section = (t: string) => console.log(`\n--- ${t} ---`)

// ── Links ───────────────────────────────────────────────────────────────────────────────────────
section('Profile links are built from the stored ID, exactly')
{
  check('the ID keeps its casing',
    cueverseProfileUrl('Starkiller') === `${CUEVERSE_ORIGIN}/profile/?name=Starkiller&game=pool`,
    cueverseProfileUrl('Starkiller') ?? '')

  /*
   * Casing matters: CueVerse keys a profile by the handle as registered. Lower-casing it here would
   * quietly 404 for anyone whose handle has a capital in it — which is most people.
   */
  check('...and is not normalised', cueverseProfileUrl('MiXeDCase')?.includes('name=MiXeDCase') === true)
  check('special characters are encoded',
    cueverseProfileUrl('a b&c=d')?.includes('name=a%20b%26c%3Dd') === true,
    cueverseProfileUrl('a b&c=d') ?? '')
  check('a unicode handle survives', cueverseProfileUrl('Ωmega')?.includes(encodeURIComponent('Ωmega')) === true)

  // No ID is not a broken link; it is no link, so the UI can say the profile is unavailable.
  check('no ID means no link', cueverseProfileUrl(null) === null)
  check('an empty ID means no link', cueverseProfileUrl('   ') === null)

  check('a replay uses CueVerse’s own form',
    cueverseReplayUrl(33952) === `${CUEVERSE_ORIGIN}/replay/?id=33952`)
}

section('Opponent cells are split the way CueVerse splits them')
{
  const one = opponentParts('Scientist')
  check('a single opponent is one link', one.length === 1 && one[0].href?.includes('name=Scientist') === true)

  /*
   * A 2v2 game records both opponents in one string. CueVerse splits on " & ", "(w/ " and ")" and
   * links each name while leaving the punctuation as text. Reproduced exactly — a different split
   * either links the punctuation or drops it, and both change what the cell says.
   */
  const pair = opponentParts('Alice & Bob')
  check('a pair becomes two links and a separator', pair.length === 3)
  check('...the names are linked', pair[0].href != null && pair[2].href != null)
  check('...and the separator is not', pair[1].href == null && pair[1].text === ' & ')

  const withPartner = opponentParts('Alice (w/ Bob)')
  check('a "(w/ …)" partner is linked too',
    withPartner.filter((p) => p.href).length === 2, JSON.stringify(withPartner))
  check('...and its brackets stay literal',
    withPartner.some((p) => p.text === '(w/ ' && !p.href) && withPartner.some((p) => p.text === ')' && !p.href))

  // CueVerse writes "?" where it has no name. Linking it would produce a profile page for "?".
  const unknown = opponentParts('Alice & ?')
  check('an unknown opponent is never linked', unknown.filter((p) => p.href).length === 1)
  check('an empty field renders a dash', opponentParts('')[0].text === '—')
  check('a name needing encoding is encoded',
    opponentParts('a b')[0].href?.includes('name=a%20b') === true)
}

section('Streaks read as W10 and L2')
{
  check('a winning run', formatStreak(10) === 'W10')
  check('a losing run', formatStreak(-2) === 'L2')
  check('no run at all', formatStreak(0) === '—')
  check('a missing value', formatStreak(null) === '—')
  check('nonsense does not render as NaN', formatStreak(Number.NaN) === '—')
}

section('Result labels follow CueVerse’s own rule')
{
  check('a win', resultLabel({ result: 'won' }) === 'Won')
  check('a loss', resultLabel({ result: 'lost' }) === 'Lost')
  check('anything else is a draw', resultLabel({ result: 'draw' }) === 'Draw')
  // A tournament game reports a placing instead of a result.
  check('a placing beats a result', resultLabel({ result: 'lost', place: 3, field: 8 }) === '3rd of 8')
  // "1st of 1" is not a placing, and CueVerse's own page requires a field of at least two.
  check('a field of one is not a placing', resultLabel({ result: 'won', place: 1, field: 1 }) === 'Won')
  check('a place without a field is not a placing', resultLabel({ result: 'won', place: 1 }) === 'Won')
  check('teens are ordinal-correct', ordinal(11) === '11th' && ordinal(12) === '12th' && ordinal(13) === '13th')
  check('...and the rest follow the last digit', ordinal(21) === '21st' && ordinal(22) === '22nd' && ordinal(33) === '33rd')
}

// ── Parsing ─────────────────────────────────────────────────────────────────────────────────────
section('The response is normalised without being recomputed')
{
  /** The shape the live endpoint returns, recorded. */
  const raw = {
    name: 'Starkiller',
    avatar: 34,
    game: 'pool',
    profile: { rating: 2096, wins: 683, losses: 289, draws: 0, total: 972, streak: 10, provisional: false },
    history: [
      { id: 33952, date: 1788219642002, opponent: 'Scientist', result: 'won', variation: '8-Ball',
        ratingBefore: 2087, ratingAfter: 2096, replayable: true, place: null, field: null, rated: true },
      { id: 33900, date: 1788210000000, opponent: 'Alice & Bob', result: 'lost', variation: '8-Ball (2 vs 2)',
        ratingBefore: 2100, ratingAfter: 2087, replayable: false, place: null, field: null, rated: true },
      { id: 33800, date: 1788200000000, opponent: 'Someone', result: 'lost', variation: '8-Ball',
        ratingBefore: null, ratingAfter: null, replayable: true, place: 3, field: 8, rated: false },
    ],
  }

  const p = normalizeProfile(raw, 'Starkiller')
  if (!p) { check('it parses', false); }
  else {
    check('it parses', true)
    /*
     * Passed through, not recalculated. 683 + 289 does not equal 972 in every CueVerse account and
     * it is not our place to reconcile it — this is their ladder and their arithmetic.
     */
    check('the rating is theirs', p.record.rating === 2096)
    check('the record is theirs', p.record.wins === 683 && p.record.losses === 289 && p.record.total === 972)
    check('the streak is formatted, not changed', p.streakLabel === 'W10' && p.record.streak === 10)

    check('rating change is the difference they reported', p.games[0].ratingChange === 9)
    check('...and is null when either end is missing', p.games[2].ratingChange === null)

    check('a replayable pool game gets a Watch link', p.games[0].watchHref === `${CUEVERSE_ORIGIN}/replay/?id=33952`)
    // Offering Watch on a game with no replay is a link to nothing.
    check('a game with no replay gets none', p.games[1].watchHref === null)
    check('a tournament game shows its placing', p.games[2].resultLabel === '3rd of 8')
    check('a 2v2 opponent is split into links', p.games[1].opponentParts.filter((x) => x.href).length === 2)
    check('the profile link uses the ID we asked with', p.profileHref.includes('name=Starkiller'))
    check('order is preserved — newest first as sent', p.games.map((g) => g.id).join(',') === '33952,33900,33800')
  }

  // A hostile or broken payload must not throw on a page about somebody's career.
  check('nonsense does not throw', normalizeProfile(null, 'x') === null)
  check('a string does not throw', normalizeProfile('nope', 'x') === null)
  const empty = normalizeProfile({}, 'Handle')
  check('an empty object yields an empty profile, not a crash',
    empty !== null && empty.games.length === 0 && empty.record.rating === 0)
  check('...and falls back to the ID for the name', empty?.name === 'Handle')
  const junk = normalizeProfile({ profile: { rating: 'abc' }, history: [null, 5] }, 'x')
  check('junk fields coerce rather than propagate', junk?.record.rating === 0 && junk?.games.length === 2)
}

section('One request, for the latest hundred')
{
  check('the limit is 100', GAME_LIMIT === 100)
}

// ── The canary ──────────────────────────────────────────────────────────────────────────────────
section('The live endpoint still has the shape this adapter expects')
{
  const url = `https://api.cueverse.gg/api/profile?name=Starkiller&game=pool&limit=${GAME_LIMIT}`
  let raw: unknown = null
  let reachable = true
  /*
    An explicit controller rather than `AbortSignal.timeout`.

    A timeout signal keeps a live timer on the event loop until it fires, so a suite that finished
    in half a second sat waiting eight more before Node would exit. Clearing it by hand costs two
    lines and lets the process end when the work does.
  */
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 8000)
  try {
    const res = await fetch(url, { signal: abort.signal })
    if (!res.ok) reachable = false
    else raw = await res.json()
  } catch {
    reachable = false
  } finally {
    clearTimeout(timer)
  }

  if (!reachable || raw == null) {
    skip('the live endpoint answers', 'CueVerse unreachable — this section is a canary, not a gate')
  } else {
    const r = raw as Record<string, unknown>
    check('it answers with the documented top-level keys',
      ['name', 'profile', 'history'].every((k) => k in r), Object.keys(r).join(','))

    const parsed = normalizeProfile(raw, 'Starkiller')
    check('the adapter parses the live response', parsed !== null)
    check('...and gets a rating', (parsed?.record.rating ?? 0) > 0)
    check('...and at most the limit asked for', (parsed?.games.length ?? 0) <= GAME_LIMIT)
    check('...with a usable replay link on a replayable game',
      parsed?.games.some((g) => g.watchHref?.startsWith(`${CUEVERSE_ORIGIN}/replay/?id=`)) === true)
    check('...and every opponent cell resolves to something renderable',
      parsed?.games.every((g) => g.opponentParts.length > 0) === true)

    // 404 is a real answer meaning "no such player", and must be told apart from a failure.
    /*
      The body is cancelled even though only the status is wanted.

      An unread response body holds its socket open, and Node tearing down with one still live
      aborts inside libuv on Windows — so a suite that passed every check exited 127 and read as a
      failure to anything checking the exit code.
    */
    const missing = await fetch('https://api.cueverse.gg/api/profile?name=NoSuchPlayerXyz123&game=pool&limit=1')
      .then(async (res) => { await res.body?.cancel(); return res.status })
      .catch(() => 0)
    check('an unknown player is a 404, distinguishable from an outage', missing === 404, String(missing))
  }
}

// -- Failure handling ----------------------------------------------------------------------------
section('A failed read is held briefly, and never by the shared cache')
{
  /*
    This section exists because of a live incident. A profile on 8br.gg showed "CueVerse is
    unavailable" while CueVerse was answering in half a second, and the page rendered in 0.4s - far
    too fast to have waited out the deadline. The message was not being produced, it was being
    replayed: the failure had been written into the shared Data Cache with the same one-minute life
    as a real answer, so one unlucky read became the answer the whole site gave.

    These assertions are about that shape, not about CueVerse being reachable.
  */
  const src = readFileSync('src/lib/cueverse/profile.ts', 'utf8')
  /* Comments explain the design; matching them would let prose pass for behaviour. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  check('a failure leaves the cached read as a throw, not as a value',
    /throw new CueverseUnavailable/.test(code))
  check('...so the shared cache is never asked to store one',
    !/unstable_cache[\s\S]{0,400}status: 'unavailable'/.test(code))
  check('an honest 404 is still cached, being a fact rather than a failure',
    /status: 'not-found'/.test(code) && !/not-found[\s\S]{0,80}throw/.test(code))

  const num = (re: RegExp) => Number(re.exec(code)?.[1]?.replace(/_/g, ''))
  const negative = num(/NEGATIVE_CACHE_MS = ([0-9_]+)/)
  const shared = num(/CACHE_SECONDS = ([0-9_]+)/) * 1000
  check('a failure is held for less time than an answer', negative < shared, `${negative}ms vs ${shared}ms`)
  check('...but is held at all, so an outage is not answered with a stampede',
    negative >= 5_000, `${negative}ms`)
  check('the hold is pruned, so it cannot grow one entry per ID for ever',
    /heldFailures\.delete/.test(code))

  /*
    The cache key carries a version. Bumping it abandons whatever the old key holds, which is what
    retires an already-poisoned entry rather than waiting for it to expire on its own.
  */
  check('the cache key is versioned', /'cueverse-profile-v[0-9]+'/.test(code))

  /* A read that fails must leave a trace: the returned status used to be the only one. */
  check('a failure is logged, with how long it took',
    /console\.error\('\[cueverse\]/.test(code) && /ms: Date\.now\(\) - started/.test(code))

  const timeout = num(/TIMEOUT_MS = ([0-9_]+)/)
  check('the deadline allows for a cold first connection', timeout >= 10_000, `${timeout}ms`)

  /* No ID is answered without consulting a cache or the network at all. */
  check('an empty ID is answered directly', (await getCueverseProfile('')).status === 'no-id')
  check('...and so is whitespace', (await getCueverseProfile('   ')).status === 'no-id')
}


console.log(`\nRESULT: ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`)
/*
  `exitCode` rather than `process.exit()`.

  Calling exit() while a socket from the live section is still closing aborts Node mid-teardown on
  Windows — libuv asserts and the process dies with 127, so a suite that passed every check reported
  a failure to anything reading the exit code. Setting the code lets the loop drain and exit on its
  own with the answer intact.
*/
process.exitCode = fail === 0 ? 0 : 1
