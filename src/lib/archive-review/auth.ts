import 'server-only'
import { headers as nextHeaders } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'

/** Roles permitted to access the archive review dashboard. */
export const REVIEW_ROLES = ['admin', 'senior_editor'] as const

export interface Reviewer {
  id: string
  email: string
  roles: string[]
}

/** Resolve the current Payload user from the session cookie (no second auth system). */
export async function getReviewer(): Promise<Reviewer | null> {
  const payload = await getPayload({ config: await config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  if (!user) return null
  const roles = (user as { roles?: string[] | null }).roles ?? []
  return { id: String(user.id), email: String(user.email ?? ''), roles }
}

export function hasReviewAccess(reviewer: Reviewer | null): boolean {
  if (!reviewer) return false
  return REVIEW_ROLES.some((r) => reviewer.roles.includes(r))
}
