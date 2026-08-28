// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import './_retired.mjs'

/**
 * Apply the authoritative identity mapping to the DB Player layer (profiles + aliases +
 * current CueVerse ID + duplicate merges). SAFE for rankings — those resolve through the
 * separate static resolver, not the Player table. Idempotent. Conservative: merges only
 * duplicates matched by an actual listed HANDLE (never guesses by name); flags ambiguities.
 *
 * Run: npx tsx scripts/migrate-identity-map.mts        (preview)
 *      npx tsx scripts/migrate-identity-map.mts --apply (write)
 */
import { prisma } from '@/lib/prisma'
import { resolveIdentity } from '@/lib/stats/identity'
import { IDENTITY_MAP, CANONICAL } from '@/lib/identity/roster-map'

const APPLY = process.argv.includes('--apply')
const nk = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

async function reassignAndDelete(fromId: string, toId: string) {
  // Move live FKs from a merged profile to the canonical one, then delete it.
  for (const reg of await prisma.registration.findMany({ where: { playerId: fromId }, select: { id: true, tournamentId: true } })) {
    const clash = await prisma.registration.findFirst({ where: { tournamentId: reg.tournamentId, playerId: toId } })
    if (clash) await prisma.registration.delete({ where: { id: reg.id } })
    else await prisma.registration.update({ where: { id: reg.id }, data: { playerId: toId } })
  }
  await prisma.tournamentTeamMember.updateMany({ where: { playerId: fromId }, data: { playerId: toId } })
  await prisma.accountClaim.updateMany({ where: { playerId: fromId }, data: { playerId: toId } })
  await prisma.playerAlias.deleteMany({ where: { playerId: fromId } }) // re-added to canonical below
  await prisma.player.delete({ where: { id: fromId } })
}

async function addAliases(playerId: string, raw: string[]) {
  const keys = new Set<string>()
  for (const r of raw) { const k = nk(r); if (k) keys.add(k); if (r.trim() && r.trim().length <= 60) keys.add(r.trim()) } // normalized + raw (for unicode/exact)
  const existing = new Set((await prisma.playerAlias.findMany({ where: { playerId }, select: { alias: true } })).map((a) => a.alias))
  const toAdd = [...keys].filter((k) => k && !existing.has(k))
  if (toAdd.length) await prisma.playerAlias.createMany({ data: toAdd.map((alias) => ({ playerId, alias, aliasType: 'HANDLE' as const })) })
  return toAdd.length
}

async function main() {
  console.log(`Identity migration — ${APPLY ? 'APPLY (writing)' : 'PREVIEW (no writes)'}\n`)
  const report: string[] = []
  const flags: string[] = []

  for (const e of IDENTITY_MAP) {
    const handles = [e.current, ...e.aliases].filter((h): h is string => !!h)
    const resolvedIds = [...new Set(handles.map((h) => resolveIdentity(h, h, { unknownAsSelf: false })).filter((r) => r && r.ok).map((r) => r!.id))]
    const keys = handles.map(nk).filter(Boolean)

    const candidates = await prisma.player.findMany({
      where: { OR: [
        { cueverseId: { in: handles, mode: 'insensitive' } },
        { legacyPlayerId: { in: resolvedIds } },
        { aliases: { some: { alias: { in: [...keys, ...handles] } } } },
        // Re-match a profile THIS migration previously created (native, no archive id) by
        // name — makes re-runs idempotent, incl. people with no CueVerse ID. Never matches
        // an archive player (those have a legacyPlayerId), so no wrong merges.
        { primaryName: { equals: e.person, mode: 'insensitive' }, legacyPlayerId: null, provenance: 'NATIVE_EGO' },
      ] },
      select: { id: true, legacyPlayerId: true, primaryName: true, cueverseId: true },
    })

    // Same-name profiles that DON'T match a handle → possible duplicates to reconcile (never auto-merged).
    const sameName = await prisma.player.findMany({ where: { primaryName: { equals: e.person, mode: 'insensitive' }, NOT: { id: { in: candidates.map((c) => c.id) } } }, select: { legacyPlayerId: true, cueverseId: true } })

    let canonicalId: string
    let action: string
    if (candidates.length) {
      const pick = candidates.find((c) => e.current && c.cueverseId?.toLowerCase() === e.current.toLowerCase())
        ?? candidates.find((c) => resolvedIds.includes(c.legacyPlayerId ?? '')) ?? candidates[0]
      canonicalId = pick.id
      const merges = candidates.filter((c) => c.id !== pick.id)
      action = `UPDATE ${pick.legacyPlayerId ?? pick.id}` + (merges.length ? ` +MERGE[${merges.map((m) => m.legacyPlayerId ?? m.id).join(',')}]` : '')
      if (APPLY) for (const m of merges) await reassignAndDelete(m.id, pick.id)
    } else {
      action = e.current ? 'CREATE new' : 'CREATE new (no CueVerse ID)'
      if (APPLY) {
        const created = await prisma.player.create({ data: { primaryName: e.person, cueverseId: e.current ?? null, active: true, linkStatus: 'UNLINKED', provenance: 'NATIVE_EGO' } })
        canonicalId = created.id
      } else canonicalId = '(new)'
    }

    if (APPLY && canonicalId !== '(new)') {
      // Link the profile to its canonical stats id (created-new people get a slug id) so
      // the profile page shows the aggregated career. Never overwrite an existing archive id.
      const canon = CANONICAL[e.person]
      const cur = await prisma.player.findUnique({ where: { id: canonicalId }, select: { legacyPlayerId: true } })
      const setLegacy = canon && !canon.startsWith('P') && !cur?.legacyPlayerId ? { legacyPlayerId: canon } : {}
      await prisma.player.update({ where: { id: canonicalId }, data: { primaryName: e.person, ...(e.current ? { cueverseId: e.current } : {}), ...setLegacy } })
    }
    const aliasCount = APPLY && canonicalId !== '(new)' ? await addAliases(canonicalId, handles) : keys.length
    report.push(`${e.person}: ${action}; cueverseId=${e.current ?? '(unknown)'}; aliases+${aliasCount}`)

    if (!e.current) flags.push(`${e.person}: no current CueVerse ID (profile has no login id — cannot generate an account).`)
    const emptyKeyAliases = handles.filter((h) => !nk(h))
    if (emptyKeyAliases.length) flags.push(`${e.person}: alias(es) [${emptyKeyAliases.join(', ')}] are unicode — stored raw for search but cannot be normalized/indexed for stats resolution.`)
    // Only meaningful when we CREATED a new profile (a same-name archive profile MIGHT be
    // this person). For handle-matched UPDATEs, same-name others are just different people.
    if (action.startsWith('CREATE') && sameName.length)
      flags.push(`${e.person}: created new — ${sameName.length} archive profile(s) share this name (may be the same person; reconcile by giving me the archive handle): ${sameName.slice(0, 6).map((s) => s.legacyPlayerId).join(', ')}${sameName.length > 6 ? '…' : ''}`)
  }

  console.log(report.join('\n'))
  console.log('\n--- FLAGS (manual review; nothing guessed) ---')
  console.log(flags.length ? flags.join('\n') : '  none')
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
