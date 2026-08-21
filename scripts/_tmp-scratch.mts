import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import * as svc from '../src/lib/competition/service.ts'
assertLocalDatabase()
const TAG = 'zzscratch'
const ACTOR = { userId: 2, username: 'scratch' }
const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })
const maxNo = (await prisma.tournament.aggregate({ _max: { number: true } }))._max.number ?? 0
const t = await prisma.tournament.create({
  data: { number: maxNo + 1, name: `${TAG} density check`, slug: `${TAG}-${maxNo + 1}`, competitionYear: 2099,
    competitionSeriesId: series.id, tournamentFormat: 'SINGLE_ELIM', participantFormat: 'INDIVIDUAL',
    lifecycleState: 'REGISTRATION_CLOSED', registrationStatus: 'CLOSED', raceLength: 5 },
  select: { id: true, number: true },
})
// 21 entrants, mirroring the real one.
const regIds: number[] = []
for (let i = 0; i < 21; i++) {
  const u = await prisma.$queryRaw<{ id: number }[]>`
    INSERT INTO payload.users (email, username, hash, salt, updated_at, created_at)
    VALUES (${`${TAG}-${i}@example.invalid`}, ${`${TAG}-${i}`}, 'x', 'x', now(), now()) RETURNING id`
  const r = await prisma.registration.create({
    data: { tournamentId: t.id, userId: Number(u[0].id), username: `${TAG}-${i}`,
            displayName: ['Ryan','Matt','Brian','Craig','Billy','Adam','Jamie','Krunal','Coma','Craig','Chris','Jason','James','Andy','Luis','Tom','Kevin','Conor','Gus','Chirag','Ryan'][i],
            cueverseId: ['outlaw.joker','own4ge','mix.masta','c_l2_a_l_g','MOLSON__CANADIAN','owned_ggs','xlx_britishpoolking_xlx','chokshi_krunal','soo.clear','camtasia.aimer','chris.dogg','british_pool_wizard','cue.ball','andy_pandy','real_creampuff','tomdapom','sixohtwo','conor_x','XX_APOCALYPSYS_XX','chirag99','kula.'][i],
            status: 'APPROVED', seed: i + 1 },
    select: { id: true },
  })
  regIds.push(r.id)
}
const r = await svc.rebuildManualPlayoff(ACTOR, t.id, regIds)
console.log('built:', JSON.stringify(r), '→ /tournaments/' + t.number)
await prisma.$disconnect()
