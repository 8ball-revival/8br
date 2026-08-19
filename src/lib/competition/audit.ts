import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export interface Actor {
  userId: number
  username: string
}

export interface AuditEntry {
  action: string // e.g. "tournament.update"
  entity: string // e.g. "Cup"
  entityId?: string | number | null
  oldValue?: unknown
  newValue?: unknown
  reason?: string | null
}

/**
 * Append an entry to the immutable audit log. Every staff mutation records who,
 * when, what changed (old → new), and an optional reason. Accepts an optional
 * transaction client so the log write is atomic with the mutation.
 */
export async function recordAudit(
  actor: Actor,
  entry: AuditEntry,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma
  await client.auditLog.create({
    data: {
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId != null ? String(entry.entityId) : null,
      oldValue: toJson(entry.oldValue),
      newValue: toJson(entry.newValue),
      reason: entry.reason ?? null,
    },
  })
}

function toJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined) return undefined
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue
}
