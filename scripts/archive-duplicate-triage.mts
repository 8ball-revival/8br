/**
 * Decide whether each near-duplicate identity is real archive history or something this pass created.
 *
 * The unique index stops an exact repeat, so a duplicate can only survive as a different SPELLING of
 * the same handle. The question that separates the two cases is not how similar they look — it is
 * whether the archive itself prints both. If the manifest carries both spellings then both are real
 * source handles, and whether they are one human is a question only the owner can answer. If it
 * carries only one, the other has no source and was manufactured here.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { loadManifest, stripSourceNote, type ManifestEntry } from '../src/lib/archive/manifest.ts'

assertLocalDatabase()

const man = loadManifest()
const entries = man.entries as ManifestEntry[]

/** every handle the archive prints, and the Seasons it prints them in */
const sourceHandles = new Map<string, string[]>()
for (const e of entries) {
  const label = `${e.competitionYear} S${e.seasonNumber}${e.division}`
  for (const p of [...e.participants, ...(e.playoff?.participants ?? [])]) {
    const h = stripSourceNote(p.normalizedHandle).toLowerCase()
    if (!h) continue
    const cur = sourceHandles.get(h) ?? []
    if (!cur.includes(label)) cur.push(label)
    sourceHandles.set(h, cur)
  }
}
console.log(`the manifest prints ${sourceHandles.size} distinct handles`)

const players = await prisma.player.findMany({
  select: { id: true, cueverseId: true, cueverseIdNormalized: true, primaryName: true, createdAt: true },
})

const fingerprint = (h: string) =>
  h.toLowerCase().replace(/[·•]/g, '').replace(/[^a-z0-9]/g, '')

const groups = new Map<string, typeof players>()
for (const p of players) {
  const f = fingerprint(p.cueverseIdNormalized ?? p.cueverseId ?? '')
  if (!f) continue
  groups.set(f, [...(groups.get(f) ?? []), p])
}

const clashes = [...groups.entries()].filter(([, v]) => v.length > 1)
console.log(`${clashes.length} handle(s) collide once punctuation and casing are removed\n`)

const bothInSource: string[] = []
const manufactured: { keep: string; drop: string; dropId: string }[] = []

for (const [f, group] of clashes) {
  const rows = group.map((p) => {
    const h = (p.cueverseIdNormalized ?? p.cueverseId ?? '').toLowerCase()
    return { p, h, seasons: sourceHandles.get(h) ?? [] }
  })
  const sourced = rows.filter((r) => r.seasons.length > 0)
  const unsourced = rows.filter((r) => r.seasons.length === 0)

  if (sourced.length > 1) {
    bothInSource.push(`${f}: ${rows.map((r) => `${r.p.cueverseId} [${r.seasons.length} Season(s)]`).join('  |  ')}`)
  } else if (sourced.length === 1 && unsourced.length > 0) {
    for (const u of unsourced) {
      manufactured.push({ keep: sourced[0].p.cueverseId ?? '', drop: u.p.cueverseId ?? '', dropId: u.p.id })
    }
  } else {
    bothInSource.push(`${f}: NEITHER spelling appears in the archive — ${rows.map((r) => r.p.cueverseId).join(' | ')}`)
  }
}

console.log(`── Both spellings printed by the archive: ${bothInSource.length} ──`)
console.log('   These are real source handles. Whether two of them are one person is an owner decision,')
console.log('   not something to infer from the spelling.')
for (const l of bothInSource) console.log(`  ${l}`)

console.log(`\n── Only one spelling has a source: ${manufactured.length} ──`)
for (const m of manufactured) console.log(`  keep ${m.keep}  /  no source for ${m.drop} (${m.dropId})`)

// ── Players with no CueVerse ID at all ───────────────────────────────────────────────────────────
const blank = players.filter((p) => !(p.cueverseIdNormalized ?? '').trim())
console.log(`\n── Players with a blank normalised CueVerse ID: ${blank.length} ──`)
for (const b of blank) {
  const entrants = await prisma.seasonEntrant.count({ where: { playerId: b.id } })
  const merged = await prisma.playerMerge.count({ where: { mergedPlayerId: b.id } }).catch(() => -1)
  console.log(`  ${b.id} cueverseId=${JSON.stringify(b.cueverseId)} name=${JSON.stringify(b.primaryName)} entrants=${entrants} mergedAway=${merged}`)
}

await prisma.$disconnect()
