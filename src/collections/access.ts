import type { Access, FieldAccess } from 'payload'
import { isAdmin, isOwner, isStaff } from '@/lib/auth/roles'

/* eslint-disable @typescript-eslint/no-explicit-any */
const rolesOf = (user: any): string[] => (Array.isArray(user?.roles) ? user.roles : [])

export function isStaffUser(user: any): boolean {
  return isStaff(rolesOf(user))
}
export function isAdminUser(user: any): boolean {
  return isAdmin(rolesOf(user))
}
export function isOwnerUser(user: any): boolean {
  return isOwner(rolesOf(user))
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Collection access: any staff (owner/admin/editor). */
export const staffOnly: Access = ({ req }) => isStaffUser(req?.user)
/**
 * Collection/global access: ADMIN-level authority only (OWNER or ADMIN).
 * Deliberately stricter than `staffOnly`: it is pinned to `isAdmin` rather than
 * `isStaff`, so if a non-admin staff tier is ever reintroduced (EDITOR is currently
 * retired) it does NOT silently inherit the right to publish site content.
 */
export const adminOnly: Access = ({ req }) => isAdminUser(req?.user)
/** Collection access: owner only (e.g. staff-account management). */
export const ownerOnly: Access = ({ req }) => isOwnerUser(req?.user)
/** Field access: only an Owner may set staff roles — prevents privilege escalation. */
export const ownerFieldOnly: FieldAccess = ({ req }) => isOwnerUser(req?.user)
