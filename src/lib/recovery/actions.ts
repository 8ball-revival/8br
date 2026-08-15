'use server'

import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'

import { recordAudit, type Actor } from '@/lib/competition/audit'
import { OWNER, ADMIN, isOwner } from '@/lib/auth/roles'
import {
  isRecoveryEnabled,
  verifyRecoveryCredentials,
  setRecoverySession,
  readRecoverySession,
  clearRecoverySession,
} from './auth'

export interface RecoveryResult {
  ok?: boolean
  error?: string
}

async function payload() {
  return getPayload({ config: await config })
}

/**
 * The synthetic actor for every recovery-initiated mutation. It is NOT a real account: userId 0
 * is a sentinel (the audit `actorUserId` column is a plain Int, not a FK), and the username is
 * prefixed `recovery:` so the log is unambiguous about who acted. This keeps break-glass actions
 * fully attributable without ever minting a hidden privileged user row.
 */
function recoveryActor(): Actor {
  return { userId: 0, username: `recovery:${process.env.RECOVERY_USERNAME ?? ''}` }
}

/**
 * Authenticate the operator. A fixed delay slows brute force. On success an httpOnly signed
 * session cookie is set and the console re-renders.
 */
export async function loginRecovery(_prev: RecoveryResult, formData: FormData): Promise<RecoveryResult> {
  // Slow down credential stuffing regardless of outcome.
  await new Promise((r) => setTimeout(r, 600))
  if (!isRecoveryEnabled()) return { error: 'Recovery is not available.' }
  const username = String(formData.get('username') ?? '')
  const password = String(formData.get('password') ?? '')
  if (!verifyRecoveryCredentials(username, password)) return { error: 'Invalid credentials' }
  await setRecoverySession()
  revalidatePath('/recovery')
  return { ok: true }
}

/** End the recovery session. */
export async function logoutRecovery(): Promise<void> {
  await clearRecoverySession()
  revalidatePath('/recovery')
}

/**
 * BREAK-GLASS OWNERSHIP TRANSFER. Demotes the current (rogue) Owner to Admin and makes the chosen
 * target the sole Owner. Requires a valid recovery session. Uses the SANCTIONED
 * `allowOwnerTransfer` Payload context (the same gate the normal transfer flow uses) so the Users
 * owner-protection hook is honoured rather than bypassed. Every run is recorded to the audit log.
 *
 * Implemented inline (not via lib/staff/roles-service.transferOwnership) because that service
 * transfers FROM the acting Owner (`actor.userId`) and requires `actor.isOwner` — neither holds
 * for a synthetic recovery operator acting AGAINST the sitting Owner.
 */
export async function transferOwnershipRecovery(targetUserId: number): Promise<RecoveryResult> {
  if (!(await readRecoverySession())) throw new Error('Recovery session required.')

  const p = await payload()

  // Resolve the current Owner(s). Exactly one is the invariant; guard defensively either way.
  const owners = await p.find({
    collection: 'users',
    where: { roles: { in: [OWNER] } },
    limit: 100,
    overrideAccess: true,
  })
  const currentOwner = owners.docs.find((d) => isOwner((d as { roles?: string[] }).roles))
  const previousOwnerId = currentOwner ? Number(currentOwner.id) : null

  const target = await p.findByID({ collection: 'users', id: targetUserId, overrideAccess: true }).catch(() => null)
  if (!target) return { error: 'Target account not found.' }
  if (previousOwnerId != null && previousOwnerId === targetUserId) return { error: 'That account is already the Owner.' }

  const ctx = { allowOwnerTransfer: true }
  // Promote the new Owner first, then demote the old — both under the sanctioned transfer context,
  // so there is never a window with zero Owners and the protection hook always permits the change.
  await p.update({ collection: 'users', id: targetUserId, data: { roles: [OWNER] }, overrideAccess: true, context: ctx })
  if (previousOwnerId != null && previousOwnerId !== targetUserId) {
    await p.update({ collection: 'users', id: previousOwnerId, data: { roles: [ADMIN] }, overrideAccess: true, context: ctx })
  }

  await recordAudit(recoveryActor(), {
    action: 'owner.recovery.transfer',
    entity: 'User',
    entityId: targetUserId,
    oldValue: { previousOwnerId },
    newValue: { newOwnerId: targetUserId },
    reason: 'Break-glass ownership recovery',
  })

  revalidatePath('/recovery')
  return { ok: true }
}
