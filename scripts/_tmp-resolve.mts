import { prisma } from '../src/lib/prisma.ts'
// Resolve by Competition + competition year + season number, never by id typed from memory.
const rows = await prisma.season.findMany({
  where: { competitionSeries: { slug: '8brcam' }, competitionYear: 2005, number: { in: [1, 2, 3] } },
  select: {
    id: true, number: true, competitionYear: true, division: true, lifecycleState: true,
    ladderAppliedAt: true, reopenedAt: true, championHandle: true, championName: true,
    competitionSeries: { select: { name: true, slug: true } },
    _count: { select: { entrants: true, groups: true, matches: true, playoffMatches: true, ratingLedger: true } },
  },
  orderBy: { number: 'asc' },
})
for (const s of rows) {
  console.log(`#${s.number} id=${s.id} ${s.competitionSeries.name} ${s.competitionYear} ` +
    `division=${JSON.stringify(s.division)} state=${s.lifecycleState} finalised=${!!s.ladderAppliedAt} reopened=${!!s.reopenedAt}`)
  console.log(`     champion=${JSON.stringify(s.championHandle ?? s.championName)} counts=${JSON.stringify(s._count)}`)
}
console.log('\nmatches for (8brcam, 2005, n):', rows.length)
console.log('unique per number:', [1,2,3].map(n => `${n}:${rows.filter(r => r.number === n).length}`).join(' '))
console.log('typeof division on Season 3:', typeof rows.find(r => r.number === 3)?.division)
await prisma.$disconnect()
