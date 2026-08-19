/**
 * Dry-run classification of every existing Season and Tournament.
 *
 * Run BEFORE any lifecycle change, and again after, so "nothing was reclassified by accident" is a
 * comparison rather than a hope. It answers, per record: which surface would show it (Live,
 * Archives, or Creator only), whether it carries completion evidence, and whether its state is
 * unambiguous.
 *
 * Deliberately READ-ONLY and deliberately opinionated about ambiguity: a record that cannot be
 * classified from canonical fields is reported as AMBIGUOUS rather than guessed into a bucket.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/lifecycle-report.mts
 *       ... --json     (machine-readable, for before/after diffing)
 */
import { prisma } from '../src/lib/prisma.ts'

const asJson = process.argv.includes('--json')

type Surface = 'live' | 'archives' | 'creator-only' | 'AMBIGUOUS'

interface Row {
  kind: 'season' | 'tournament'
  id: number
  label: string
  year: number | null
  lifecycle: string
  published: boolean | null
  completedAt: string | null
  champion: string | null
  ledgerRows: number
  surface: Surface
  notes: string[]
}

const rows: Row[] = []

// ── Seasons ──────────────────────────────────────────────────────────────────────────────────────
const seasons = await prisma.season.findMany({
  select: {
    id: true, number: true, competitionYear: true, subtitle: true, slug: true,
    lifecycleState: true, completedAt: true, championName: true, championPlayerId: true,
    ladderAppliedAt: true, division: true,
    competitionSeries: { select: { name: true } },
    _count: { select: { entrants: true, matches: true, playoffMatches: true, ratingLedger: true } },
  },
  orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }],
})

for (const s of seasons) {
  const notes: string[] = []
  let surface: Surface

  const completed = s.lifecycleState === 'COMPLETED'
  const finalized = s.ladderAppliedAt != null

  if (completed && finalized) {
    surface = 'archives'
  } else if (completed && !finalized) {
    surface = 'AMBIGUOUS'
    notes.push('COMPLETED but no ladderAppliedAt — completion evidence missing, so archive eligibility cannot be asserted')
  } else if (s.lifecycleState === 'DRAFT' || s.lifecycleState === 'REGISTRATION_SCHEDULED') {
    surface = 'creator-only'
  } else {
    surface = 'live'
  }

  if (completed && !s.championPlayerId) notes.push('completed with no championPlayerId')
  if (s._count.ratingLedger === 0 && completed) notes.push('completed with zero ranking-ledger rows')

  rows.push({
    kind: 'season',
    id: s.id,
    label: `${s.competitionSeries.name} Season ${s.number}${s.subtitle ? ` — ${s.subtitle}` : ''}`,
    year: s.competitionYear,
    lifecycle: s.lifecycleState,
    published: null,
    completedAt: s.completedAt?.toISOString() ?? null,
    champion: s.championName,
    ledgerRows: s._count.ratingLedger,
    surface,
    notes,
  })
}

// ── Tournaments ──────────────────────────────────────────────────────────────────────────────────
const tournaments = await prisma.tournament.findMany({
  select: {
    id: true, name: true, competitionYear: true, status: true, championHandle: true,
    _count: { select: { ratingLedger: true } },
  },
  orderBy: [{ competitionYear: 'asc' }, { id: 'asc' }],
}).catch(() => [] as never[])

for (const t of tournaments) {
  const notes: string[] = []
  let surface: Surface
  const status = String(t.status)

  if (status === 'COMPLETED') {
    surface = t._count.ratingLedger > 0 || t.championHandle ? 'archives' : 'AMBIGUOUS'
    if (surface === 'AMBIGUOUS') notes.push('COMPLETED with neither a champion nor ranking-ledger rows')
  } else if (status === 'DRAFT' || status === 'SETUP') {
    surface = 'creator-only'
  } else if (status === 'CANCELLED') {
    surface = 'creator-only'
    notes.push('cancelled — excluded from both Live and Archives')
  } else {
    surface = 'live'
  }

  rows.push({
    kind: 'tournament',
    id: t.id,
    label: t.name,
    year: t.competitionYear ?? null,
    lifecycle: status,
    published: null,
    completedAt: null,
    champion: t.championHandle,
    ledgerRows: t._count.ratingLedger,
    surface,
    notes,
  })
}

// ── Ranking contributions already materialised ───────────────────────────────────────────────────
const ledgerBySeason = await prisma.$queryRaw<{ seasonId: number | null; tournamentId: number | null; n: bigint }[]>`
  SELECT "seasonId", "tournamentId", count(*) AS n FROM "public"."rating_ledger"
   GROUP BY "seasonId", "tournamentId" ORDER BY 1 NULLS LAST, 2 NULLS LAST`

if (asJson) {
  console.log(JSON.stringify({ rows, ledgerBySeason: ledgerBySeason.map((r) => ({ ...r, n: Number(r.n) })) }, null, 2))
} else {
  const bucket = (s: Surface) => rows.filter((r) => r.surface === s)
  console.log(`\n${rows.length} records — ${seasons.length} Seasons, ${tournaments.length} Tournaments\n`)
  for (const s of ['live', 'archives', 'creator-only', 'AMBIGUOUS'] as Surface[]) {
    const list = bucket(s)
    console.log(`${s.toUpperCase()} (${list.length})`)
    for (const r of list) {
      console.log(`  [${r.kind}#${r.id}] ${r.label} · ${r.year ?? 'no year'} · ${r.lifecycle}`
        + ` · ledger ${r.ledgerRows}${r.champion ? ` · champion ${r.champion}` : ''}`)
      for (const n of r.notes) console.log(`      ! ${n}`)
    }
    console.log('')
  }
  console.log('Ranking contributions already materialised:')
  for (const l of ledgerBySeason) {
    console.log(`  ${l.seasonId != null ? `season#${l.seasonId}` : l.tournamentId != null ? `tournament#${l.tournamentId}` : '(unattributed)'}: ${Number(l.n)} rows`)
  }
  const ambiguous = bucket('AMBIGUOUS').length
  console.log(`\n${ambiguous === 0 ? 'No ambiguous records — every entry classifies from canonical fields.' : `${ambiguous} AMBIGUOUS record(s) — do not migrate these without a decision.`}`)
}

await prisma.$disconnect()
