/**
 * Seed the two demonstration LIVE cups (#12 individual, #13 2v2) so the inline Cup
 * workspace can be exercised end-to-end. Idempotent: re-running resets ONLY these two
 * live cups (never touches imported historical cups). No results are invented — brackets
 * are seeded as DRAFT (unpublished); an admin publishes/edits them through the Cup page.
 *
 * Run: npx tsx scripts/seed-live-cups.mts   (then: npm run cups:snapshot)
 *
 * Uses direct Prisma + the pure `planBracket` (the services are `server-only` and cannot
 * load under tsx); it mirrors exactly what the workspace actions do.
 */
import { prisma } from '@/lib/prisma'
import { planBracket, type Qualifier } from '@/lib/competition/bracket'

async function resetLiveCup(cupNumber: number) {
  const existing = await prisma.season.findFirst({ where: { competitionType: 'CUP', cupNumber } })
  if (existing) {
    if (existing.importedFromFixture) throw new Error(`Refusing to reset imported historical cup #${cupNumber}`)
    await prisma.season.delete({ where: { id: existing.id } }) // cascades registrations/teams/playoff matches
    console.log(`  reset existing live cup #${cupNumber}`)
  }
}

/** Persist a single-elim bracket (DRAFT) from an ordered seed list, exactly like rebuildManualPlayoff. */
async function buildDraftBracket(seasonId: number, qualifiers: Qualifier[]) {
  const plan = planBracket(qualifiers)
  const idByIndex: Record<number, number> = {}
  for (const m of plan.matches) {
    const created = await prisma.playoffMatch.create({
      data: {
        seasonId,
        round: m.round,
        slot: m.slot,
        label: m.label,
        homeRegistrationId: m.home.registrationId,
        awayRegistrationId: m.away.registrationId,
        homeUsername: m.home.username,
        awayUsername: m.away.username,
        homeSeed: m.home.seed,
        awaySeed: m.away.seed,
      },
    })
    idByIndex[m.index] = created.id
  }
  for (const m of plan.matches) {
    if (m.feedsIndex !== null) {
      await prisma.playoffMatch.update({ where: { id: idByIndex[m.index] }, data: { feedsMatchId: idByIndex[m.feedsIndex], feedsSlot: m.feedsSlot } })
    }
  }
  return plan.bracketSize
}

async function seedCup12() {
  await resetLiveCup(12)
  const season = await prisma.season.create({
    data: {
      slug: 'cup-12',
      name: '9 Ball Cup',
      competitionType: 'CUP',
      competitionCode: 'C012',
      cupNumber: 12,
      gameType: '9-Ball',
      participantFormat: 'INDIVIDUAL',
      tournamentFormat: 'SINGLE_ELIM',
      cupFormatBadge: '1v1',
      raceLength: 7,
      cupYear: new Date().getFullYear(),
      cupDate: new Date().toISOString().slice(0, 10),
      cupStatus: 'live',
      seasonStatus: 'UPCOMING',
      registrationStatus: 'NOT_OPEN',
      playoffsStatus: 'PENDING',
      importedFromFixture: false,
      locked: false,
      formatSummary: 'Single-elimination bracket',
      eligibilitySummary: 'Entrants added by administrators. No camera required.',
    },
  })
  // 16 entrants from real Player profiles (linked), so the field is realistic + replaceable.
  const players = await prisma.player.findMany({ where: { active: true }, take: 16, orderBy: { primaryName: 'asc' } })
  const qualifiers: Qualifier[] = []
  for (let i = 0; i < players.length; i++) {
    const p = players[i]
    const reg = await prisma.registration.create({
      data: { seasonId: season.id, username: p.primaryName, displayName: p.primaryName, cueverseId: p.cueverseId, playerId: p.id, status: 'APPROVED', addedByAdmin: true, approvedAt: new Date(), seed: i + 1 },
    })
    qualifiers.push({ registrationId: reg.id, username: p.primaryName, seed: i + 1 })
  }
  const size = qualifiers.length >= 2 ? await buildDraftBracket(season.id, qualifiers) : 0
  console.log(`  cup #12 "9 Ball Cup" — ${qualifiers.length} entrants, draft bracket size ${size}`)
}

async function seedCup13() {
  await resetLiveCup(13)
  const season = await prisma.season.create({
    data: {
      slug: 'cup-13',
      name: 'Sit and Stand 2v2',
      competitionType: 'CUP',
      competitionCode: 'C013',
      cupNumber: 13,
      gameType: '8-Ball',
      participantFormat: 'TEAM',
      teamSize: 2,
      tournamentFormat: 'SINGLE_ELIM',
      cupFormatBadge: '2v2',
      raceLength: 7,
      cupYear: new Date().getFullYear(),
      cupDate: new Date().toISOString().slice(0, 10),
      cupStatus: 'live',
      seasonStatus: 'UPCOMING',
      registrationStatus: 'NOT_OPEN',
      playoffsStatus: 'PENDING',
      importedFromFixture: false,
      locked: false,
      formatSummary: 'Single-elimination bracket',
      eligibilitySummary: 'Teams added by administrators. No camera required.',
    },
  })
  // 10 teams (temporary rosters) → a 16-slot bracket with 6 byes.
  const teams: { name: string; members: [string, string] }[] = [
    { name: 'Dreamers', members: ['Missy', 'Luke'] },
    { name: 'Regulators', members: ['Jake', 'Neo'] },
    { name: 'Transformers', members: ['Allen', 'Jon'] },
    { name: 'Sharks', members: ['Rob', 'Danny'] },
    { name: 'Hustlers', members: ['Chris', 'Paul'] },
    { name: 'Cue Kings', members: ['Mike', 'Tony'] },
    { name: 'Break Point', members: ['Sam', 'Alex'] },
    { name: 'Rack Attack', members: ['Nate', 'Vic'] },
    { name: 'Side Pocket', members: ['Dave', 'Ray'] },
    { name: 'Felt Legends', members: ['Kyle', 'Ben'] },
  ]
  const qualifiers: Qualifier[] = []
  for (let i = 0; i < teams.length; i++) {
    const t = teams[i]
    const reg = await prisma.registration.create({
      data: { seasonId: season.id, username: t.name, displayName: t.name, status: 'APPROVED', addedByAdmin: true, approvedAt: new Date(), seed: i + 1 },
    })
    const team = await prisma.cupTeam.create({ data: { seasonId: season.id, registrationId: reg.id, name: t.name, seed: i + 1 } })
    await prisma.cupTeamMember.createMany({
      data: t.members.map((name, mi) => ({ teamId: team.id, name, memberOrder: mi, captain: mi === 0 })),
    })
    qualifiers.push({ registrationId: reg.id, username: t.name, seed: i + 1 })
  }
  const size = await buildDraftBracket(season.id, qualifiers)
  console.log(`  cup #13 "Sit and Stand 2v2" — ${teams.length} teams, draft bracket size ${size} (${size - teams.length} byes)`)
}

async function main() {
  console.log('Seeding live demonstration cups…')
  await seedCup12()
  await seedCup13()
  console.log('Done. Run `npm run cups:snapshot` to refresh the derived snapshot.')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
