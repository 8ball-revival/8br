/**
 * Seed the ACTUAL 2026 Season 2 entrant list into the live competition DB as
 * account-independent entrants (comp_registration). Matching is CONSERVATIVE — an
 * entrant is LINKED to an existing Player profile only via an owner-confirmed
 * resolution (FORCE, no broad archive guessing) or an EXACT primary CueVerse ID.
 * Every other roster player becomes a correct UNLINKED entrant carrying their
 * submitted display name + CueVerse ID (no guessed links, no duplicate profiles —
 * staff can link them later on /staff/players). Idempotent: clears prior admin-added
 * entrants first, and never duplicates a profile per season.
 *
 *   npx tsx scripts/seed-season2-entrants.mts
 */
import { resolveIdentity } from '../src/lib/stats/identity.ts'
import { prisma } from '../src/lib/prisma.ts'

const ROSTER: { name: string; handle: string; discord?: string; timezone?: string }[] = [
  { name: 'Neo', handle: 'Starkiller', discord: 'stepatdis', timezone: 'MST' },
  { name: 'Kevin', handle: 'sixohtwo', discord: 'draftcat', timezone: 'EST' },
  { name: 'Travis', handle: 'Travis', discord: 'takeo9820', timezone: 'EST' },
  { name: 'Sid', handle: 'easyrun', discord: 'sidlerr_', timezone: 'BST' },
  { name: 'Brice', handle: 'Bricycle', discord: 'planetnine9', timezone: 'EST' },
  { name: 'Craig', handle: 'Chiddy', discord: 'chiddy0807', timezone: 'EST' },
  { name: 'Derrick', handle: 'GODLIKE', discord: 'fowl5221', timezone: 'EST' },
  { name: 'Missy', handle: 'Missy', discord: '.pink.___05817', timezone: 'EST' },
  { name: 'Luke', handle: 'Luke', discord: 'lukehandle', timezone: 'EST' },
  { name: 'Koty', handle: 'Xx_Koty_xX', discord: 'xxkotyxx', timezone: 'CST' },
  { name: 'George', handle: 'xlx_ogges_xlx', discord: 'ogges1989', timezone: 'UK' },
  { name: 'Jeremy', handle: 'pro_jeremy', discord: 'ogjerbear', timezone: 'CST' },
  { name: 'Cameron', handle: 'Cam', discord: 'cameron.skillz', timezone: 'CST' },
  { name: 'Irfan', handle: 'irfs07', discord: 'irfan091010', timezone: 'EST' },
  { name: 'Justin', handle: 'Cue', discord: 'jzillawz', timezone: 'EST' },
  { name: 'Leigh', handle: 'LJ', discord: 'leighjohn__', timezone: 'ACST' },
  { name: 'Faisal', handle: 'Faisal', discord: 'sicc1', timezone: 'PKST' },
  { name: 'Chiraag', handle: 'i.am_the_zodiac', discord: 'jabronni16', timezone: 'GMT' },
  { name: 'Saqib', handle: 'NooB', discord: 'saqs4115', timezone: 'PKST' },
  { name: 'Steve', handle: 'n00bski11z', discord: 'bigsteve_1991', timezone: 'UK' },
  { name: 'Stu', handle: 'Stu', discord: 'stu00405', timezone: 'GMT' },
  { name: 'Jefe', handle: 'JEFE', discord: 'amteban9130', timezone: 'CST' },
  { name: 'Nakz', handle: 'Nakz', discord: 'nakz_2917', timezone: 'GMT' },
  { name: 'Sean', handle: 'Lilsparky67', discord: 'lilsparky67', timezone: 'EST' },
  { name: 'Peter', handle: 'eskimo', discord: 'whishy', timezone: 'EST' },
]

const season = await prisma.tournament.findUnique({ where: { slug: 'ego-season-2' } })
if (!season) { console.error('No ego-season-2 found.'); process.exit(1) }

// Idempotent: clear prior admin-added entrants (keeps account/self-registrations).
await prisma.registration.deleteMany({ where: { seasonId: season.id, addedByAdmin: true } })

const linked: string[] = []
const unlinked: string[] = []
const skipped: string[] = []

for (const r of ROSTER) {
  // CONSERVATIVE link: owner-confirmed resolver (no broad archive map) → profile,
  // else exact primary CueVerse ID. No alias/name guessing.
  let profile = null as Awaited<ReturnType<typeof prisma.player.findFirst>> | null
  const id = resolveIdentity(r.handle, r.name, { useArchiveMap: false })
  if (id?.ok) profile = await prisma.player.findUnique({ where: { legacyPlayerId: id.id } })
  if (!profile) profile = await prisma.player.findFirst({ where: { cueverseId: { equals: r.handle, mode: 'insensitive' } } })

  if (profile) {
    const existing = await prisma.registration.findUnique({ where: { seasonId_playerId: { seasonId: season.id, playerId: profile.id } } })
    if (existing) { skipped.push(`${r.name} (already: ${profile.primaryName})`); continue }
    await prisma.registration.create({
      data: { seasonId: season.id, userId: null, username: profile.primaryName, status: 'APPROVED', approvedAt: new Date(), addedByAdmin: true, displayName: profile.primaryName, cueverseId: profile.cueverseId, discord: profile.discord, timeZone: profile.timeZone, playerId: profile.id },
    })
    linked.push(`${r.name} → ${profile.primaryName}${profile.cueverseId ? ` (${profile.cueverseId})` : ''}`)
  } else {
    await prisma.registration.create({
      data: { seasonId: season.id, userId: null, username: r.name, status: 'APPROVED', approvedAt: new Date(), addedByAdmin: true, displayName: r.name, cueverseId: r.handle, discord: r.discord ?? null, timeZone: r.timezone ?? null, playerId: null },
    })
    unlinked.push(`${r.name} (${r.handle})`)
  }
}

console.log(`\nLINKED to existing profiles (${linked.length}):`)
linked.forEach((m) => console.log('  ' + m))
console.log(`\nUNLINKED entrants — name + CueVerse ID, staff can link later (${unlinked.length}):`)
unlinked.forEach((m) => console.log('  ' + m))
console.log(`\nSkipped (already entered) (${skipped.length}):`, skipped.join(', ') || '—')
console.log(`\nSeason 2 active entrants now:`, await prisma.registration.count({ where: { seasonId: season.id, status: 'APPROVED' } }))
await prisma.$disconnect()
