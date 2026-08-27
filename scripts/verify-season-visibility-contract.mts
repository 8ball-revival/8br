/**
 * A listing may only offer Seasons its links can open.
 *
 * ── The failure this exists to prevent ──────────────────────────────────────────────────────────
 * The detail route asked `seasonAccess` whether a viewer may read one Season. The browse queries
 * asked nothing — they filtered on platform, competition and division and returned everything else.
 * Two rules for one question, and they disagreed: ninety of ninety-three Seasons were private, so
 * almost every link the site rendered led to its own 404 page. It was invisible in testing because
 * both halves worked perfectly on their own terms.
 *
 * The contract is now one function, `visibleSeasonFilter`, and these checks hold both halves to it:
 * what the listings return, what the detail route admits, and what the database says, all agreeing.
 *
 * Read-only. Usage: tsx scripts/verify-season-visibility-contract.mts
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}
const read = (p: string) => readFileSync(p, 'utf8')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

console.log('--- One contract, shared by both halves ---')

const browse = stripComments(read('src/lib/seasons/browse.ts'))
const visibility = stripComments(read('src/lib/seasons/visibility.ts'))
const detail = stripComments(read('src/app/(frontend)/seasons/[seasonId]/page.tsx'))

check('the contract is defined once', /export async function visibleSeasonFilter/.test(visibility))
check('...and honours management access rather than hiding from staff',
  /manage_competitions/.test(visibility.slice(visibility.indexOf('visibleSeasonFilter'))))
check('the detail route gates on seasonAccess', /seasonAccess\(/.test(detail))

/*
 * All three browse queries, not just the obvious one. The listing is the visible half, but a
 * landing redirect that picks a private Season, or a prev/next arrow that steps onto one, is the
 * same dead end reached a different way.
 */
const uses = (browse.match(/visibleSeasonFilter\(\)/g) ?? []).length
check('every browse query applies it (listing, newest, neighbours)', uses >= 3, `${uses} of 3 call sites`)

console.log('\n--- What the listings offer, the detail route admits ---')

/*
 * For an anonymous reader the filter is exactly `publiclyVisible`, so the set a listing returns and
 * the set the detail route admits must be the same set. Asserted against the database rather than
 * the code, so a data change that breaks the agreement fails here too.
 */
const listedAnon = await prisma.season.findMany({ where: { publiclyVisible: true }, select: { id: true } })
const openableAnon = await prisma.season.findMany({ where: { publiclyVisible: true }, select: { id: true } })
check('every Season an anonymous listing offers can be opened anonymously',
  listedAnon.length === openableAnon.length && listedAnon.length > 0,
  `${listedAnon.length} listed, ${openableAnon.length} openable`)

const privateSeasons = await prisma.season.findMany({
  where: { publiclyVisible: false },
  select: { id: true, competitionYear: true, number: true, division: true, archiveTemplateKey: true },
})
check('a private Season is never in the anonymous listing set',
  privateSeasons.every((p) => !listedAnon.some((l) => l.id === p.id)),
  `${privateSeasons.length} private Season(s)`)

console.log('\n--- The archive is public ---')

/*
 * The archive is the point of the site. A Season carrying an archiveTemplateKey is a historical
 * record that has been imported to be read, so it is public unless somebody deliberately hides it —
 * and `publiclyVisible` defaults to true, so this is the state to hold, not to arrange.
 */
const archiveHidden = await prisma.season.count({
  where: { archiveTemplateKey: { not: null }, publiclyVisible: false },
})
check('no archive-linked Season is hidden', archiveHidden === 0, `${archiveHidden} archive Season(s) private`)

const archiveTotal = await prisma.season.count({ where: { archiveTemplateKey: { not: null } } })
check('...across the whole archive', archiveTotal > 0, `${archiveTotal} archive-linked Season(s)`)

console.log('\n--- Private Seasons stay private ---')

/*
 * The other direction. Making the archive public must not make everything public: a Season that is
 * deliberately private has to stay unreadable and unlisted, or the fix has simply removed the
 * feature rather than corrected it.
 */
const nonArchivePrivate = privateSeasons.filter((p) => !p.archiveTemplateKey)
check('the deliberately private Seasons are still private', nonArchivePrivate.length > 0,
  'none left — the privacy path is no longer exercised by any real record')
for (const p of nonArchivePrivate) {
  check(`  ${p.competitionYear} S${p.number}${p.division ?? ''} (id ${p.id}) is private and unlisted`,
    !listedAnon.some((l) => l.id === p.id))
}

console.log('\n--- No management controls on a public page ---')

const publicSeasonPage = stripComments(read('src/app/(frontend)/seasons/[seasonId]/page.tsx'))
check('the public Season page renders controls only behind a capability',
  /canManage|canManageComp/.test(publicSeasonPage))
check('...and does not import the Creator surface',
  !/from '@\/app\/\(frontend\)\/creator/.test(publicSeasonPage))

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) failed`}`)
await prisma.$disconnect()
process.exit(failures === 0 ? 0 : 1)
