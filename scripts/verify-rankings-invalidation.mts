/**
 * Verifies that a change to ranked data actually reaches the Rankings.
 *
 * The Rankings aggregate is held in `unstable_cache` under LADDER_EXPLORER_TAG. Revalidating the
 * PATH `/rankings` re-renders the page, which then reads the same cached rows straight back — so a
 * mutation that only revalidates paths looks invalidated and refreshes nothing. This suite exists
 * because exactly that happened on the Season side: `revalidateSeason` cleared two paths and never
 * the tag, so every group and playoff result recorded there sat behind a five-minute window.
 *
 * These are structural checks on the source. Cache behaviour cannot be exercised outside a Next
 * request, but "does the mutation path reach the invalidator" can be, and that is the part that rots.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-rankings-invalidation.mts
 */
import io from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (rel: string) => io.readFileSync(path.join(ROOT, rel), 'utf8')

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/** Exported server actions in a file, with their bodies. */
function actions(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = []
  const re = /\nexport async function (\w+)/g
  let m: RegExpExecArray | null
  const starts: { name: string; at: number }[] = []
  while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index })
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].at : src.length
    out.push({ name: starts[i].name, body: src.slice(starts[i].at, end) })
  }
  return out
}

/** A read-only action changes nothing, so it has nothing to invalidate. */
const READ_ONLY = /^(search|list|get|preview|suggest|export)/

/**
 * Writes that genuinely have no cached reader, with the reason.
 *
 * Kept as a named list rather than a looser rule so that adding one is a decision somebody makes on
 * purpose, and so the next person can check the reason still holds.
 */
const NO_CACHED_READER: Record<string, string> = {
  // A per-admin default used to prefill the create form, read back through its own server action on
  // demand. Nothing renders it from a cache, so there is nothing to expire.
  saveFlairDefaultAction: 'per-admin form default, read on demand',
}

section('The invalidator clears the DATA, not just the pages')
{
  const src = read('src/lib/stats/invalidate-rankings.ts')
  check('it expires the ladder aggregate by tag', /revalidateTag\(\s*LADDER_EXPLORER_TAG/.test(src))
  check('it expires the homepage figures by tag', /revalidateTag\(\s*REGISTRY_STATS_TAG/.test(src))
  check('...and only then revalidates the pages', /revalidatePath\('\/rankings'\)/.test(src))
  check('it never throws outside a request', /catch\s*\{/.test(src))
}

section('The cached readers actually carry the tag')
{
  const src = read('src/lib/stats/ladder-explorer.ts')
  const cached = [...src.matchAll(/unstable_cache\(/g)].length
  check('the ladder has cached readers', cached > 0, String(cached))
  const tagged = [...src.matchAll(/tags:\s*\[LADDER_EXPLORER_TAG\]/g)].length
  check('every one of them is tagged', tagged === cached, `${tagged} tagged of ${cached} cached`)
}

section('Both revalidate helpers reach the invalidator')
for (const [file, fn] of [
  ['src/lib/competition/tournament-actions.ts', 'revalidateTournament'],
  ['src/lib/seasons/actions.ts', 'revalidateSeason'],
  ['src/lib/competition/actions.ts', 'revalidateAll'],
] as const) {
  const src = read(file)
  const start = src.indexOf(`function ${fn}(`)
  const body = start === -1 ? '' : src.slice(start, src.indexOf('\n}', start))
  check(`${fn} exists`, start !== -1)
  check(`${fn} clears the rankings aggregate`, body.includes('invalidateRankings()'),
    'it only revalidates paths — the page would read the same cached rows back')
}

section('Every mutating action revalidates something')
for (const file of [
  'src/lib/competition/tournament-actions.ts',
  'src/lib/seasons/actions.ts',
  'src/lib/competition/actions.ts',
]) {
  const src = read(file)
  const missing = actions(src)
    .filter((a) => !READ_ONLY.test(a.name) && !(a.name in NO_CACHED_READER))
    .filter((a) => !/revalidate\w*\(|invalidateRankings/.test(a.body))
    .map((a) => a.name)
  check(`${path.basename(file)}: no mutating action forgets to revalidate`,
    missing.length === 0, missing.join(', '))
}

section('The Season path is wired the same way the Tournament path is')
{
  const seasons = read('src/lib/seasons/actions.ts')
  // Recording a group result is the commonest ranked write in the whole app.
  const save = actions(seasons).find((a) => a.name === 'saveSeasonGroupAction')
  check('saveSeasonGroupAction exists', save != null)
  check('...and it revalidates through the Season helper',
    /revalidateSeason\(/.test(save?.body ?? ''))
  check('closeSeasonAction no longer double-invalidates',
    (actions(seasons).find((a) => a.name === 'closeSeasonAction')?.body.match(/invalidateRankings\(\)/g) ?? []).length === 0,
    'the helper does it now')
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1
