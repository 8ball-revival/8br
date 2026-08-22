/**
 * The public navigation: one permanent tab per competition type, and nothing left pointing at the
 * sections that were folded away.
 *
 * Live and Archives were two dropdowns, each opening a Seasons/Cups pair. They are gone, replaced by
 * Seasons and Cups as top-level tabs. The risk in a change like that is not the new pages — it is
 * what still refers to the old ones: a link in a corner of the site, a redirect pointing at a route
 * that no longer renders, a filter pushing to a path that now bounces. Those fail quietly, so they
 * are what this looks for.
 *
 * Structural, so it runs without a server. The rendered result is checked for real in
 * verification/nav/routes.mjs.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-navigation.mts
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { buildNav, PRIMARY_NAV } from '../src/lib/nav.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const read = (f: string) => readFileSync(f, 'utf8')

/** Every shipped source file, so "nothing anywhere still links there" can be taken literally. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full.replace(/\\/g, '/'))
  }
  return out
}

// ─────────────────────────────────────────────────────────────────── the bar itself
section('The bar reads Home · Seasons · Cups · Creator? · Rankings · News · Admin?')
{
  const pub = buildNav({})
  const staff = buildNav({ canCreate: true, adminItems: [{ label: 'Admin', href: '/staff' }] })
  const labels = (n: { label: string }[]) => n.map((e) => e.label).join(' · ')

  check('a visitor sees Home · Seasons · Tournaments · Rankings · The Break',
    labels(pub) === 'Home · Seasons · Tournaments · Rankings · The Break', labels(pub))
  check('staff additionally see Creator and Admin, in place',
    labels(staff) === 'Home · Seasons · Tournaments · Creator · Rankings · The Break · Admin', labels(staff))

  // The two administrative entries are the only conditional ones. Everything else is for everybody.
  const conditional = staff.filter((e) => !pub.some((p) => p.href === e.href)).map((e) => e.label)
  check('Creator and Admin are the ONLY entries gated on a role',
    conditional.join(',') === 'Creator,Admin', conditional.join(','))

  check('the footer list agrees with the bar',
    PRIMARY_NAV.some((e) => e.href === '/seasons') && PRIMARY_NAV.some((e) => e.href === '/tournaments')
    && !PRIMARY_NAV.some((e) => e.href.startsWith('/archives')), JSON.stringify(PRIMARY_NAV))
}

// ─────────────────────────────────────────────────────────────────── the dropdown is really gone
section('The dropdown machinery is gone, not merely unused')
{
  const nav = read('src/lib/nav.ts')
  const main = read('src/components/main-nav.tsx')
  const mobile = read('src/components/mobile-nav.tsx')

  check('nav exports no menu type', !/NavMenu|isMenu|LIVE_MENU|ARCHIVES_MENU/.test(nav))
  check('the desktop bar has no dropdown', !/NavDropdown|aria-haspopup|openLabel/.test(main))
  check('...and no live dot left over from the Live trigger', !/LiveDot|animate-ping/.test(main))
  check('the mobile drawer has no grouped section', !/isMenu|entry\.items/.test(mobile))

  // A header that still queries what is live only to decide a tab that no longer exists is a query
  // on every page load for nothing.
  const header = read('src/components/site-header.tsx')
  check('the header no longer asks what is live just to draw the bar',
    !header.includes('getLiveSummary'), 'still calling getLiveSummary')
}

// ─────────────────────────────────────────────────────────────────── old URLs still resolve
section('Every retired URL still resolves, with its query string')
{
  const redirects: [string, string][] = [
    ['src/app/(frontend)/live/seasons/route.ts', '/seasons'],
    ['src/app/(frontend)/live/cups/route.ts', '/tournaments'],
    ['src/app/(frontend)/live/tournaments/route.ts', '/tournaments'],
    ['src/app/(frontend)/archives/seasons/route.ts', '/seasons'],
    ['src/app/(frontend)/archives/cups/route.ts', '/tournaments'],
    ['src/app/(frontend)/archives/tournaments/route.ts', '/tournaments'],
  ]
  for (const [file, target] of redirects) {
    if (!existsSync(file)) { check(`${file} exists`, false, 'missing'); continue }
    const src = read(file)
    check(`${file} → ${target}`, src.includes(`url.pathname = '${target}'`), 'wrong or missing target')
    check(`${file} is a permanent redirect`, /308/.test(src))
    /*
     * The query string carries the reader's filters. `nextUrl.clone()` keeps it; building a fresh URL
     * from the pathname alone silently drops it, and every shared filtered link stops working.
     */
    check(`${file} keeps the query string`, src.includes('nextUrl.clone()'))
  }

  /*
   * A target that bounces BACK is the failure mode that matters.
   *
   * /cups → /tournaments in next.config.ts once existed alongside a /tournaments → /cups route
   * handler; the two aimed at each other and every public URL was unreachable until the browser
   * gave up. So: the target must exist, and must not send the reader back where they came from.
   *
   * /seasons legitimately redirects ONWARD, into the most recent Season. That is a destination.
   */
  for (const [, target] of redirects) {
    const page = `src/app/(frontend)${target}/page.tsx`
    check(`${target} exists`, existsSync(page), page)
    if (!existsSync(page)) continue
    const src = read(page)
    const bouncesBack = redirects.some(([from]) => {
      const origin = from.replace('src/app/(frontend)', '').replace('/route.ts', '')
      return src.includes(`'${origin}'`) || src.includes(`\`${origin}\``)
    })
    check(`${target} does not redirect back to a retired URL`, !bouncesBack, page)
  }

  /*
   * next.config now OWNS the /cups mapping, and must be the only thing that does.
   *
   * Both halves are pinned: the config declares it, and no route handler under /tournaments points
   * back — which is precisely the pair that used to deadlock.
   */
  const config = read('next.config.ts')
  check('next.config.ts maps /cups onto /tournaments', /source:\s*'\/cups'/.test(config))
  check('...and every path beneath it', /source:\s*'\/cups\/:path\*'/.test(config))
  check('no /tournaments route handler fights it', !existsSync('src/app/(frontend)/tournaments/route.ts'))
  check('...at any depth', !existsSync('src/app/(frontend)/tournaments/[number]/route.ts'))
}

// ─────────────────────────────────────────────────────────────────── nothing points at the old ones
section('Nothing in the shipped source links into the retired sections')
{
  const files = walk('src').filter((f) =>
    // The redirect routes themselves are allowed to name their own path.
    !/src\/app\/\(frontend\)\/(live|archives)\//.test(f))

  const offenders: string[] = []
  for (const f of files) {
    const src = read(f)
    // Strip comments: prose may describe the change, and describing it is not linking to it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    if (/['"`]\/(live|archives)\/(seasons|cups|tournaments)/.test(code)) offenders.push(f)
  }
  check('no link, redirect target or revalidate path names /live or /archives',
    offenders.length === 0, offenders.join(', '))

  // The one that used to push filter changes back to /archives/<kind>, which would bounce every
  // filter click through a redirect.
  const browser = read('src/components/competition/archive-browser.tsx')
  check('the filter controls push straight to the new paths',
    browser.includes('router.push(`/${kind}'), 'archive-browser still pushes to /archives')
}

// ─────────────────────────────────────────────────────────── the listing, and its one admin door
section('Tournaments is a public listing with a single administrative entry')
{
  const src = read('src/app/(frontend)/tournaments/page.tsx')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  check('Tournaments lists every Tournament, running and finished', /getTournamentList/.test(code))
  check('...through the searchable list rather than a new component', code.includes('TournamentList'))
  check('...is never cached, so one that completes moves out of Active immediately',
    code.includes("dynamic = 'force-dynamic'") && code.includes('revalidate = 0'))

  /*
   * This page DOES resolve staff access, unlike the read-only listing it replaced.
   *
   * That is the restored behaviour and the point of it: creating a Tournament starts here rather
   * than in Creator. What matters is that the control is gated on the capability that governs the
   * action — not on "is staff", which an editor also satisfies — and that the route behind it
   * re-checks rather than trusting a hidden button.
   */
  check('the Create control is drawn from the competition-management capability',
    code.includes("can('manage_competitions')"))
  check('...and not from a broad staff test', !/isStaff\(/.test(code))
  check('...pointing into the Tournaments section', code.includes('/tournaments/new'))

/*
 * The gate moved with the work.
 *
 * These routes are redirect stubs now: creating and editing a competition happens in Creator, and
 * Creator's own page enforces the capability. Asserting the check on the OLD file would be asserting
 * that a redirect guards something it no longer does, so the assertion follows the work.
 */
  const create = read('src/app/(frontend)/creator/tournaments/new/page.tsx')
  /*
   * `requireCreator` IS the capability check.
   *
   * It resolves staff access, tests `manage_competitions`, and renders a not-found to everybody
   * else — so grepping for the capability string in the page would now assert the absence of a
   * helper rather than the presence of a guard. The named guard is the thing to look for.
   */
  check('the creation route enforces the same capability itself',
    create.includes('requireCreator'))
  check('...and the legacy URL only forwards to it',
    read('src/app/(frontend)/tournaments/new/page.tsx').includes('/creator/tournaments/new'))
}

/*
 * Seasons is different on purpose.
 *
 * Tournaments needs a listing because there is nothing else to show. Seasons has the Season browser — with
 * Competition, Year and Season pickers and the standings on screen — so the tab opens the most
 * recent Season directly rather than a page of summaries to click through.
 */
section('Seasons opens the browser on the most recent Season')
{
  const src = read('src/app/(frontend)/seasons/page.tsx')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  check('it opens a Season rather than listing them', code.includes('redirect(`/seasons/'))
  check('...chosen by the same rule the pickers use', code.includes('newestSeasonId'))
  check('...addressed by immutable id, never the display number',
    !/redirect\(`\/seasons\/\$\{[^}]*[Nn]umber/.test(code))
  check('...carrying the Competition filter through', code.includes("one('competition')"))
  check('...and the requested view', code.includes("'playoffs' : 'groups'"))
  check('...never cached, so a Season that completes is not opened as if it were still running',
    code.includes("dynamic = 'force-dynamic'") && code.includes('revalidate = 0'))
  check('an empty registry says so rather than erroring', code.includes('No Seasons Yet'))

  // Read-only, same as everywhere else public.
  check('...it offers no management control',
    !/\/creator|Reopen|Delete|New Season/.test(code), 'management control on a public page')
  check('...and does not resolve staff access',
    !/resolveStaffAccess|requireCapability|canSeeCreator/.test(code))
}

// ─────────────────────────────────────────────────────────────────── labels
section('Labels name the thing, not the section it used to live in')
{
  const completed = read('src/components/creator/completed-list.tsx')
  check('Creator links out with "View Season" / "View Tournament"',
    completed.includes("'View Season'") && completed.includes("'View Tournament'"))
  check('...and no longer says "View Public Archive"', !completed.includes('View Public Archive'))

  const all = walk('src').map(read).join('\n')
  check('no surface offers a "View Public Archive" link', !/View Public Archive/.test(all))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
