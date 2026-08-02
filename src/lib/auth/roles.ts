/**
 * Single source of truth for staff roles and capabilities. Pure functions over a
 * string[] of role values — no framework imports — so both Payload access control
 * (collections/access.ts) and the Next server layer (competition/staff-auth.ts)
 * enforce the SAME rules. Never rely on hidden UI; every protected server operation
 * checks a capability here.
 *
 * Role hierarchy (highest first): OWNER > ADMIN > EDITOR. MEMBER = public account
 * with no staff access.
 */

export type Role = 'owner' | 'admin' | 'editor' | 'member'

export const OWNER: Role = 'owner'
export const ADMIN: Role = 'admin'
export const EDITOR: Role = 'editor'
export const MEMBER: Role = 'member'

/** Roles that may reach the staff admin console (capabilities restrict further). */
export const STAFF_ROLES: Role[] = [OWNER, ADMIN, EDITOR]

/** Options for the Payload `roles` select field. */
export const ROLE_OPTIONS: { label: string; value: Role }[] = [
  { label: 'Owner', value: OWNER },
  { label: 'Admin', value: ADMIN },
  { label: 'Editor', value: EDITOR },
  { label: 'Member', value: MEMBER },
]

/** Normalize legacy role values (none expected on a fresh DB, but safe). */
function normalize(roles: string[] | undefined | null): string[] {
  return (Array.isArray(roles) ? roles : []).map((r) => (r === 'senior_editor' ? ADMIN : r))
}

export function hasRole(roles: string[] | null | undefined, role: Role): boolean {
  return normalize(roles).includes(role)
}
export function isOwner(roles: string[] | null | undefined): boolean {
  return normalize(roles).includes(OWNER)
}
/** Admin-level = OWNER or ADMIN. */
export function isAdmin(roles: string[] | null | undefined): boolean {
  const r = normalize(roles)
  return r.includes(OWNER) || r.includes(ADMIN)
}
/** Any staff (OWNER/ADMIN/EDITOR). */
export function isStaff(roles: string[] | null | undefined): boolean {
  return normalize(roles).some((r) => (STAFF_ROLES as string[]).includes(r))
}

/**
 * Capabilities are the unit of server-side authorization. Each protected action
 * requires exactly one. This maps the role matrix to concrete permissions.
 */
export type Capability =
  | 'manage_staff' // create/edit staff accounts, grant/remove roles — OWNER only
  | 'delete_competition' // permanent deletion of a Season/Cup — OWNER only
  | 'manage_competitions' // create/edit/archive/restore Seasons & Cups, groups, brackets, publish — ADMIN+
  | 'manage_registrations' // approve/reject/edit registrations — ADMIN+
  | 'manage_players' // create/edit/merge/deactivate players — ADMIN+
  | 'edit_results' // enter/correct scores, schedules, verify match details — EDITOR+
  | 'view_audit' // view the audit log — ADMIN+

const CAPABILITY_RULES: Record<Capability, (roles: string[]) => boolean> = {
  manage_staff: isOwner,
  delete_competition: isOwner,
  manage_competitions: isAdmin,
  manage_registrations: isAdmin,
  manage_players: isAdmin,
  edit_results: isStaff,
  view_audit: isAdmin,
}

/** True if the given roles grant the capability. */
export function can(roles: string[] | null | undefined, cap: Capability): boolean {
  return CAPABILITY_RULES[cap](normalize(roles))
}

/**
 * Which roles a given actor is allowed to ASSIGN to others. Only an Owner may
 * grant Owner or Admin; nobody below Owner can create staff. Used to block
 * privilege escalation server-side.
 */
export function assignableRoles(actorRoles: string[] | null | undefined): Role[] {
  if (isOwner(actorRoles)) return [OWNER, ADMIN, EDITOR, MEMBER]
  return [] // only Owner manages staff roles
}
