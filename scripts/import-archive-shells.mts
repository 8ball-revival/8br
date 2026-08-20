/**
 * Create one private reconstruction shell for every entry in the 8BRCAM manifest.
 *
 * ── A shell is an empty Season and nothing else ──────────────────────────────────────────────────
 * No Player, no account, no alias, no entrant, no group, no match, no result, no standing, no
 * bracket, no champion, no title, no ledger row. The archive says who played and what the scores
 * were, but which real person each historical handle belongs to is the owner's decision — so this
 * creates the container and stops. Everything else is the manual reconstruction workflow.
 *
 * ── Private by construction ──────────────────────────────────────────────────────────────────────
 * `publiclyVisible: false` and `reconstruction: true` together are what keep these out of the public
 * Seasons list, Live, the homepage, search, profiles and the Rankings — the existing lifecycle rules
 * already read both, so this does not invent a second visibility system it would have to keep in
 * step. Registration is PASSWORD so nobody can wander into one.
 *
 * ── Idempotent ───────────────────────────────────────────────────────────────────────────────────
 * `archiveTemplateKey` is unique in the database, so a second run cannot duplicate anything even if
 * the guard below were wrong. The guard exists so a re-run is silent rather than an error.
 *
 * Default is a DRY RUN. Writing requires --apply.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/import-archive-shells.mts
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/import-archive-shells.mts --apply
 */
import { randomBytes, scryptSync } from 'node:crypto'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { loadManifest, validateManifest, isSharedStage } from '../src/lib/archive/manifest.ts'
import { recordAudit } from '../src/lib/competition/audit.ts'

assertLocalDatabase('import-archive-shells')

const APPLY = process.argv.includes('--apply')
const REPORT_DIR = 'verification/archive-8brcam'
const COMPETITION_SLUG = '8brcam'
const actor = { userId: 2, username: 'admin' }

/** Hash a join password the same way the Season service does. */
function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(plain, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

interface Counts {
  players: number; entrants: number; groups: number; matches: number
  standings: number; playoffs: number; ledger: number; aliases: number; seasons: number
}

async function counts(): Promise<Counts> {
  const [players, entrants, groups, matches, standings, playoffs, ledger, aliases, seasons] = await Promise.all([
    prisma.player.count(),
    prisma.seasonEntrant.count(),
    prisma.seasonGroup.count(),
    prisma.seasonMatch.count(),
    prisma.seasonStanding.count(),
    prisma.seasonPlayoffMatch.count(),
    prisma.ratingLedger.count(),
    prisma.playerAlias.count(),
    prisma.season.count(),
  ])
  return { players, entrants, groups, matches, standings, playoffs, ledger, aliases, seasons }
}

async function main() {
  const manifest = loadManifest()
  const issues = validateManifest(manifest)
  if (issues.length > 0) {
    console.log(`Manifest has ${issues.length} validation issue(s). Refusing to import.`)
    for (const i of issues.slice(0, 10)) console.log(`  ${i.templateKey}: ${i.problem} — ${i.detail}`)
    throw new Error('manifest validation failed')
  }
  console.log(`Manifest validated: ${manifest.entries.length} entries, 0 issues.\n`)

  const series = await prisma.competitionSeries.findUnique({
    where: { slug: COMPETITION_SLUG }, select: { id: true, name: true, active: true },
  })
  if (!series) throw new Error(`Competition "${COMPETITION_SLUG}" not found.`)
  if (!series.active) throw new Error(`Competition "${COMPETITION_SLUG}" is inactive.`)

  const before = await counts()
  console.log('Before:', JSON.stringify(before))

  const existing = new Map(
    (await prisma.season.findMany({
      where: { archiveTemplateKey: { not: null } },
      select: { id: true, archiveTemplateKey: true },
    })).map((s) => [s.archiveTemplateKey!, s.id]),
  )

  /*
   * A Season number is unique within a Competition and YEAR — not within a division.
   *
   * Division A and Division B of the same Season share a number, so the existing uniqueness rule
   * would reject the second of the pair. The shells are written directly rather than through
   * createSeason for exactly this reason: the service enforces one Season per number per year, which
   * is right for new Seasons and wrong for a historical divisional pair that genuinely shared one.
   */
  const created: { templateKey: string; seasonId: number; label: string }[] = []
  const skipped: string[] = []

  for (const e of manifest.entries) {
    if (existing.has(e.templateKey)) { skipped.push(e.templateKey); continue }
    if (!APPLY) { created.push({ templateKey: e.templateKey, seasonId: -1, label: e.rawSeasonTitle }); continue }

    const season = await prisma.$transaction(async (tx) => {
      const s = await tx.season.create({
        data: {
          competitionSeriesId: series.id,
          competitionYear: e.competitionYear,
          number: e.seasonNumber,
          division: e.division,
          // The site's own convention, with the division appended: A and B of one Season share a
          // number, so without it the pair would collide on the slug as well.
          slug: `${COMPETITION_SLUG}-season-${e.seasonNumber}-${e.competitionYear}-div-${e.division.toLowerCase()}`,
          subtitle: null,
          // Registration open so entrants can be added by hand; PASSWORD so nobody can join.
          lifecycleState: 'REGISTRATION_OPEN',
          accessMode: 'PASSWORD',
          joinPasswordHash: hashPassword(randomBytes(18).toString('base64url')),
          lounge: 'Social',
          // The two flags the lifecycle rules already read to keep something out of every public
          // surface and out of the Rankings.
          publiclyVisible: false,
          reconstruction: true,
          groupStageGames: e.gamesPerMatch ?? 10,
          archiveTemplateKey: e.templateKey,
          dataCompleteness: e.groupAssignments === 'complete' && e.exactResults === 'complete'
            ? 'complete'
            : 'partial',
        },
        select: { id: true },
      })

      await recordAudit(actor, {
        action: 'season.archive.shell.create',
        entity: 'Season',
        entityId: s.id,
        newValue: {
          templateKey: e.templateKey,
          sourceKey: e.sourceKey,
          year: e.competitionYear,
          number: e.seasonNumber,
          division: e.division,
          sharedGroupStage: isSharedStage(e),
        },
      }, tx)

      return s
    })

    created.push({ templateKey: e.templateKey, seasonId: season.id, label: e.rawSeasonTitle })
  }

  const after = await counts()
  console.log('After: ', JSON.stringify(after))

  const drift: string[] = []
  for (const k of ['players', 'entrants', 'groups', 'matches', 'standings', 'playoffs', 'ledger', 'aliases'] as const) {
    if (before[k] !== after[k]) drift.push(`${k}: ${before[k]} → ${after[k]}`)
  }

  console.log()
  console.log(`${APPLY ? 'Created' : 'Would create'}: ${created.length}`)
  console.log(`Already present:  ${skipped.length}`)
  console.log(drift.length === 0
    ? 'Nothing but Seasons changed — no Player, entrant, group, match, standing, playoff, alias or ledger row.'
    : `UNEXPECTED CHANGES: ${drift.join(', ')}`)

  if (APPLY) {
    if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true })
    writeFileSync(`${REPORT_DIR}/shell-import.json`, JSON.stringify({
      ranAt: new Date().toISOString(),
      manifestSources: manifest.sourceFiles,
      before, after, drift,
      created, skipped,
    }, null, 2))
    console.log(`\nReport → ${REPORT_DIR}/shell-import.json`)
  } else {
    console.log('\nDRY RUN. Re-run with --apply to write.')
  }

  if (drift.length > 0) throw new Error('the import changed something it should not have')
}

let code = 0
try {
  await main()
} catch (e) {
  code = 1
  console.log('\nFAILED: ' + (e instanceof Error ? e.message : String(e)))
} finally {
  await prisma.$disconnect()
}
process.exit(code)
