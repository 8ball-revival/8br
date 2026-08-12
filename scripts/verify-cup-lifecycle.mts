import { prisma } from '../src/lib/prisma.ts'
import { transitionTournamentState, getTournamentState, assertCompletable, requireTournamentState, canTransition } from '../src/lib/competition/tournament-lifecycle.ts'
let pass=0, fail=0
const check=(n:string,c:boolean)=>{ if(c){pass++;console.log('  ✓ '+n)}else{fail++;console.log('  ✗ '+n)} }
const actor={userId:990900,username:'cup-verify'}

// Create a synthetic test cup in DRAFT.
const cup = await prisma.tournament.create({ data: { slug:'zzz-verify-cup', name:'Verify Cup', code:'CVERIFY', number:99001, lifecycleState:'DRAFT', registrationStatus:'NOT_OPEN', status:'UPCOMING', playoffsStatus:'PENDING', raceLength:5, participantFormat:'INDIVIDUAL' } })
const id = cup.id
try {
  const st = async () => getTournamentState((await prisma.tournament.findUniqueOrThrow({ where:{id} })))
  check('starts DRAFT', await st()==='DRAFT')

  // Invalid skip rejected.
  const bad = await transitionTournamentState(actor, id, 'IN_PROGRESS')
  check('DRAFT→IN_PROGRESS rejected (invalid skip)', !bad.ok && /Invalid transition/.test(bad.error||''))

  check('DRAFT→REGISTRATION_OPEN ok', (await transitionTournamentState(actor,id,'REGISTRATION_OPEN')).ok)
  check('  registrationStatus synced OPEN', (await prisma.tournament.findUniqueOrThrow({where:{id}})).registrationStatus==='OPEN')
  check('REGISTRATION_OPEN→COMPLETED rejected', !(await transitionTournamentState(actor,id,'COMPLETED')).ok)
  check('REGISTRATION_OPEN→REGISTRATION_CLOSED ok', (await transitionTournamentState(actor,id,'REGISTRATION_CLOSED')).ok)
  check('  registrationStatus synced CLOSED', (await prisma.tournament.findUniqueOrThrow({where:{id}})).registrationStatus==='CLOSED')

  // NEW: bracket generation is its own state; REGISTRATION_CLOSED can no longer skip to IN_PROGRESS.
  check('matrix: REGISTRATION_CLOSED→IN_PROGRESS not allowed', !canTransition('REGISTRATION_CLOSED','IN_PROGRESS'))
  check('matrix: REGISTRATION_CLOSED→BRACKET_GENERATED allowed', canTransition('REGISTRATION_CLOSED','BRACKET_GENERATED'))
  check('matrix: BRACKET_GENERATED→IN_PROGRESS allowed', canTransition('BRACKET_GENERATED','IN_PROGRESS'))
  const skip = await transitionTournamentState(actor, id, 'IN_PROGRESS')
  check('REGISTRATION_CLOSED→IN_PROGRESS rejected (must generate bracket first)', !skip.ok && /Invalid transition/.test(skip.error||''))
  check('REGISTRATION_CLOSED→BRACKET_GENERATED ok', (await transitionTournamentState(actor,id,'BRACKET_GENERATED')).ok)
  check('  status stays UPCOMING in BRACKET_GENERATED (not started)', (await prisma.tournament.findUniqueOrThrow({where:{id}})).status==='UPCOMING')
  check('  reporting gate: requireTournamentState IN_PROGRESS rejected while BRACKET_GENERATED', !(await requireTournamentState(id,['IN_PROGRESS'])).ok)
  check('BRACKET_GENERATED→IN_PROGRESS ok (explicit begin)', (await transitionTournamentState(actor,id,'IN_PROGRESS')).ok)

  // Completion gate: no bracket yet.
  const noBracket = await transitionTournamentState(actor, id, 'COMPLETED')
  check('IN_PROGRESS→COMPLETED blocked (no bracket)', !noBracket.ok && /bracket/i.test(noBracket.error||''))

  // Build a minimal decided final.
  const r1 = await prisma.registration.create({ data:{ tournamentId:id, username:'A', status:'APPROVED' } })
  const r2 = await prisma.registration.create({ data:{ tournamentId:id, username:'B', status:'APPROVED' } })
  await prisma.playoffMatch.create({ data:{ tournamentId:id, round:1, slot:1, homeRegistrationId:r1.id, awayRegistrationId:r2.id, winnerRegistrationId:r1.id, homeGames:5, awayGames:2, status:'COMPLETED', published:true } })
  check('assertCompletable passes with decided final', (await assertCompletable(id))===null)

  const done = await transitionTournamentState(actor, id, 'COMPLETED')
  check('IN_PROGRESS→COMPLETED ok (final decided)', done.ok)
  const afterComplete = await prisma.tournament.findUniqueOrThrow({ where:{id} })
  check('  ladderAppliedAt set once', afterComplete.ladderAppliedAt!=null)
  const firstApplied = afterComplete.ladderAppliedAt

  check('COMPLETED→CANCELLED rejected (terminal, no recovery)', !(await transitionTournamentState(actor,id,'CANCELLED')).ok)

  // Completed-lock: every normal mutation gate rejects server-side once COMPLETED.
  const lockScore = await requireTournamentState(id, ['IN_PROGRESS'])
  check('completed cup: scoring gate rejected (locked)', !lockScore.ok && /completed and locked/i.test(lockScore.error||''))
  const lockEntrants = await requireTournamentState(id, ['REGISTRATION_OPEN','REGISTRATION_CLOSED'])
  check('completed cup: entrant gate rejected (locked)', !lockEntrants.ok)
  const lockBracket = await requireTournamentState(id, ['REGISTRATION_CLOSED','BRACKET_GENERATED'])
  check('completed cup: bracket-edit gate rejected (locked)', !lockBracket.ok)

  // Recovery: COMPLETED→IN_PROGRESS (owner recovery), then re-complete: ladder NOT re-applied.
  check('recovery COMPLETED→IN_PROGRESS ok', (await transitionTournamentState(actor,id,'IN_PROGRESS',{reason:'reopen',recovery:true})).ok)
  await transitionTournamentState(actor, id, 'COMPLETED')
  const afterRe = await prisma.tournament.findUniqueOrThrow({ where:{id} })
  check('ladder NOT re-applied (idempotent — timestamp unchanged)', afterRe.ladderAppliedAt?.getTime()===firstApplied?.getTime())

  // State-change audit trail exists.
  const audits = await prisma.auditLog.count({ where:{ actorUsername:'cup-verify', action:{ in:['tournament.state','tournament.state.recovery','tournament.ladder.apply'] } } })
  check('state changes + ladder are audited', audits>=5)
} finally {
  await prisma.tournament.delete({ where:{ id } }).catch(()=>{}) // cascades registrations + matches
  await prisma.auditLog.deleteMany({ where:{ actorUsername:'cup-verify' } })
  const { regenerateTournamentSnapshot } = await import('../src/lib/tournaments/migrate.ts')
  await regenerateTournamentSnapshot().catch(()=>{})
  console.log('cleaned up synthetic cup + audit + snapshot')
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect(); process.exit(fail===0?0:1)
