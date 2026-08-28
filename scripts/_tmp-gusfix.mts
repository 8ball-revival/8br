// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import './_retired.mjs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { changeCueverseId } from '../src/lib/players/service.ts'
assertLocalDatabase()
const GUS = 'cmsza3ul10008js04shgkmziz'
const before = await prisma.player.findUniqueOrThrow({ where: { id: GUS }, select: { primaryName: true, cueverseId: true } })
console.log('before:', JSON.stringify(before))
const r = await changeCueverseId(
  { userId: 2, username: 'admin', isAdmin: true, isOwner: true } as never,
  GUS, 'PRO_BALL',
  { override: true, reason: 'Reverting an email address set as a public CueVerse ID' },
)
console.log('change:', JSON.stringify(r))
console.log('after:', JSON.stringify(await prisma.player.findUniqueOrThrow({ where: { id: GUS }, select: { primaryName: true, cueverseId: true } })))
console.log('entrant rows still carrying the address:',
  (await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM "public"."season_entrant" WHERE "username" LIKE '%lx__tav0__xl%'`)[0].n)
await prisma.$disconnect()
