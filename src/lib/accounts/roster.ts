import 'server-only'
import { prisma } from '@/lib/prisma'
import { getAllArchiveSeasons } from '@/lib/seasons/archive'
import { getCups } from '@/lib/cups/service'
import { resolveIdentity } from '@/lib/stats/identity'

/**
 * Build the INITIAL account roster from players who participated in the four seed
 * competitions: 2026 Season 1, DBT8 (Cup 10), 602 Invitational (Cup 9), and the Creampuff
 * Classic (Cup 11). Every named competitor is resolved through the SAME canonical identity
 * resolver the stats use (never guessed): a confident match to a Player profile becomes a
 * roster entry; anything unresolved (or resolved to a profile without a CueVerse ID) is
 * returned separately for manual review. Deduplicated by Player profile.
 */

const SEED_SEASON_IDS = ['2026-s1']
const SEED_CUP_NUMBERS = [9, 10, 11]

const COMP_LABEL: Record<string, string> = {
  '2026-s1': '2026 Season 1',
  'cup-9': '602 Invitational',
  'cup-10': 'DBT8',
  'cup-11': 'Creampuff Classic',
}

export interface RosterPlayer {
  playerId: string
  cueverseId: string | null
  primaryName: string
  competitions: string[]
  alreadyHasAccount: boolean
  canGenerate: boolean // resolved, has a CueVerse ID, and no account yet
}
export interface RosterUnresolved {
  name: string
  handle: string | null
  competitions: string[]
  reason: 'unresolved' | 'no-cueverse-id'
}
export interface InitialRoster {
  players: RosterPlayer[]
  unresolved: RosterUnresolved[]
  counts: { resolved: number; generatable: number; alreadyHaveAccounts: number; unresolved: number }
}

type Slot = { name?: string | null; handle?: string | null } | null | undefined

export async function buildInitialRoster(): Promise<InitialRoster> {
  // Canonical id (== Player.legacyPlayerId) → Player, plus account-existence lookup.
  const players = await prisma.player.findMany({
    select: { id: true, legacyPlayerId: true, primaryName: true, cueverseId: true, linkedUserId: true },
  })
  const byLegacy = new Map(players.filter((p) => p.legacyPlayerId).map((p) => [p.legacyPlayerId!, p]))

  // Gather every (name, handle, competition) participant pair from the seed events.
  const participants: { name: string; handle: string | null; comp: string }[] = []
  const addSlot = (s: Slot, comp: string) => {
    if (!s || !s.name || s.name === 'Bye') return
    participants.push({ name: s.name, handle: s.handle ?? null, comp })
  }

  // Archive seasons (group standings + playoff / double-elim brackets).
  for (const season of getAllArchiveSeasons()) {
    if (!SEED_SEASON_IDS.includes(season.seasonId)) continue
    const label = COMP_LABEL[season.seasonId] ?? season.label
    for (const d of season.divisions) {
      for (const g of d.groups ?? []) for (const row of g.rows) addSlot(row, label)
      for (const r of d.playoff?.rounds ?? []) for (const m of r.matches) { addSlot(m.a, label); addSlot(m.b, label) }
      if (d.doubleElim) for (const br of [d.doubleElim.winners, d.doubleElim.losers]) for (const r of br) for (const m of r.matches) { addSlot(m.a, label); addSlot(m.b, label) }
    }
  }

  // Cups (single- or double-elim brackets).
  for (const c of getCups()) {
    if (!SEED_CUP_NUMBERS.includes(c.number)) continue
    const label = COMP_LABEL[`cup-${c.number}`] ?? c.name
    for (const round of [...(c.bracket ?? []), ...(c.winnersBracket ?? []), ...(c.losersBracket ?? []), ...(c.grandFinal ?? [])]) {
      for (const m of round.matches) { addSlot(m.a, label); addSlot(m.b, label) }
    }
  }

  const resolvedById = new Map<string, RosterPlayer>()
  const unresolvedByKey = new Map<string, RosterUnresolved>()

  for (const p of participants) {
    const r = resolveIdentity(p.handle, p.name, { unknownAsSelf: false })
    const player = r && r.ok ? byLegacy.get(r.id) : undefined
    if (player) {
      const existing = resolvedById.get(player.id)
      if (existing) {
        if (!existing.competitions.includes(p.comp)) existing.competitions.push(p.comp)
      } else {
        resolvedById.set(player.id, {
          playerId: player.id,
          cueverseId: player.cueverseId,
          primaryName: player.primaryName,
          competitions: [p.comp],
          alreadyHasAccount: player.linkedUserId != null,
          canGenerate: !!player.cueverseId && player.linkedUserId == null,
        })
      }
    } else {
      // Unresolved OR resolved-to-a-profile-without-a-CueVerse-ID → manual review.
      const key = `${p.name.toLowerCase()}|${(p.handle ?? '').toLowerCase()}`
      const reason: RosterUnresolved['reason'] = 'unresolved'
      const ex = unresolvedByKey.get(key)
      if (ex) { if (!ex.competitions.includes(p.comp)) ex.competitions.push(p.comp) }
      else unresolvedByKey.set(key, { name: p.name, handle: p.handle, competitions: [p.comp], reason })
    }
  }

  // A resolved player with no CueVerse ID can't get a login — surface for review.
  const players2: RosterPlayer[] = []
  for (const rp of resolvedById.values()) {
    if (!rp.cueverseId) {
      unresolvedByKey.set(`profile:${rp.playerId}`, { name: rp.primaryName, handle: null, competitions: rp.competitions, reason: 'no-cueverse-id' })
    } else {
      players2.push(rp)
    }
  }
  players2.sort((a, b) => a.cueverseId!.localeCompare(b.cueverseId!))
  const unresolved = [...unresolvedByKey.values()].sort((a, b) => a.name.localeCompare(b.name))

  return {
    players: players2,
    unresolved,
    counts: {
      resolved: players2.length,
      generatable: players2.filter((p) => p.canGenerate).length,
      alreadyHaveAccounts: players2.filter((p) => p.alreadyHasAccount).length,
      unresolved: unresolved.length,
    },
  }
}
