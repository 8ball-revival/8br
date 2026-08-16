/**
 * Regenerate a fresh one-time claim code for every UNCLAIMED migrated account and write a complete
 * admin-only list. Use this whenever the codes need to be (re)issued — it invalidates any previous
 * code for that account (only the sha256 hash is stored, so old plaintext codes are unrecoverable).
 * Accounts already claimed by their owner are skipped. Idempotent to run; each run issues new codes.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { prisma } from '../src/lib/prisma.ts'

// Self-contained: write reports inside this 8BR project's own migration-reports folder.
const OUT_DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'migration-reports')
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars
const CLAIM_TTL_DAYS = 30
const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '')
const hashCode = (c: string) => crypto.createHash('sha256').update(normalizeCode(c)).digest('hex')
const genCode = () => {
  const pick = () => Array.from({ length: 5 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')
  return `${pick()}-${pick()}`
}

const claims = await prisma.accountClaim.findMany({ where: { status: 'UNCLAIMED' }, orderBy: { userId: 'asc' } })
const users = await prisma.$queryRawUnsafe<{ id: number; username: string }[]>(`SELECT id, username FROM payload.users`)
const nameByUser = new Map(users.map((u) => [u.id, u.username]))
const players = await prisma.player.findMany({ where: { id: { in: claims.map((c) => c.playerId).filter(Boolean) } }, select: { id: true, primaryName: true, cueverseId: true } })
const playerById = new Map(players.map((p) => [p.id, p]))
const expiresAt = new Date(Date.now() + CLAIM_TTL_DAYS * 86400_000)

const rows: { username: string; code: string; ranking: string }[] = []
for (const c of claims) {
  const username = nameByUser.get(c.userId)
  if (!username) continue
  const code = genCode()
  await prisma.accountClaim.update({ where: { userId: c.userId }, data: { claimCodeHash: hashCode(code), claimCodeExpiresAt: expiresAt } })
  const p = playerById.get(c.playerId)
  rows.push({ username, code, ranking: p?.cueverseId ?? p?.primaryName ?? '' })
}

mkdirSync(OUT_DIR, { recursive: true })
const md = [
  `# Migrated account claim codes`,
  `Generated: ${new Date().toISOString()}`,
  `Expires: ${expiresAt.toISOString()} (${CLAIM_TTL_DAYS} days)`,
  ``,
  `Each owner claims their account at **/claim-account** — enter the Login ID (username) + the claim`,
  `code, then set their own password. Codes are one-time; this list supersedes any previous codes.`,
  ``,
  `| Login ID (username) | Claim code |`,
  `|---|---|`,
  ...rows.map((r) => `| ${r.username} | ${r.code} |`),
  ``,
  `Total: ${rows.length} accounts`,
].join('\n')
const path = `${OUT_DIR}/claim-codes.md`
writeFileSync(path, md, 'utf8')
console.log(md)
console.log(`\nWritten: ${path}`)
await prisma.$disconnect()
