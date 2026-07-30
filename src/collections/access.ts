import type { Access, FieldAccess } from 'payload'

const STAFF_ROLES = ['admin', 'senior_editor', 'editor']

/* eslint-disable @typescript-eslint/no-explicit-any */
function roles(user: any): string[] {
  return Array.isArray(user?.roles) ? user.roles : []
}
export function isStaffUser(user: any): boolean {
  return roles(user).some((r) => STAFF_ROLES.includes(r))
}
export function isAdminUser(user: any): boolean {
  return roles(user).includes('admin')
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Collection access: staff (admin/senior_editor/editor) only. */
export const staffOnly: Access = ({ req }) => isStaffUser(req?.user)
/** Field access: admins only (e.g. changing roles — prevents self-escalation). */
export const adminFieldOnly: FieldAccess = ({ req }) => isAdminUser(req?.user)
