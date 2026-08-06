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

/** Roles that may reach the staff admin console (capabilities restrict further).
 *  The active model is OWNER / ADMIN / MEMBER — EDITOR is retired (normalized to MEMBER). */
export const STAFF_ROLES: Role[] = [OWNER, ADMIN]

/**
 * Options for the Payload `roles` select field. The active role model is
 * OWNER / ADMIN / MEMBER. EDITOR is retired and is NOT selectable; any legacy
 * `editor` (or `senior_editor`) value is normalized to MEMBER (see `normalize`) so
 * a legacy account safely loses staff access rather than being auto-promoted.
 */
export const ROLE_OPTIONS: { label: string; value: Role }[] = [
  { label: 'Owner', value: OWNER },
  { label: 'Admin', value: ADMIN },
  { label: 'Member', value: MEMBER },
]

/** Normalize legacy role values: retired EDITOR tiers collapse to MEMBER (no auto-promotion
 *  to staff), per the confirmed migration decision. Safe on a fresh DB (no such rows). */
function normalize(roles: string[] | undefined | null): string[] {
  return (Array.isArray(roles) ? roles : []).map((r) =>
    r === 'senior_editor' || r === 'editor' ? MEMBER : r,
  )
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
  | 'manage_staff' // create/edit staff accounts, grant/remove roles — OWNER only (Payload fallback)
  | 'delete_competition' // permanent deletion of a Season/Cup — OWNER only
  | 'manage_competitions' // create/edit/archive/restore Seasons & Cups, groups, brackets, publish — ADMIN+
  | 'manage_registrations' // approve/reject/edit registrations — ADMIN+
  | 'manage_players' // create/edit/merge/deactivate players — ADMIN+
  | 'edit_results' // enter/correct scores, schedules, verify match details — ADMIN+
  | 'view_audit' // view the audit log — ADMIN+
  | 'moderate_members' // issue/remove Warnings, Timeouts, Bans — ADMIN+
  | 'delete_account' // soft-delete (status DELETED) + restore an account — OWNER only
  | 'override_eligibility' // override any competition eligibility decision — OWNER only
  | 'purge_account' // permanent (hard) account deletion — OWNER only
  | 'transfer_ownership' // transfer the single Owner designation — OWNER only

// NOTE: `manage_admins` (create/promote/demote/remove Administrators + set Head Admin) is
// NOT a pure-role capability — it also requires the Head Administrator DESIGNATION (or Owner),
// which is a StaffDesignation sidecar, not a role. It is resolved on the actor in staff-auth.ts.
const CAPABILITY_RULES: Record<Capability, (roles: string[]) => boolean> = {
  manage_staff: isOwner,
  delete_competition: isOwner,
  manage_competitions: isAdmin,
  manage_registrations: isAdmin,
  manage_players: isAdmin,
  edit_results: isStaff,
  view_audit: isAdmin,
  moderate_members: isAdmin,
  delete_account: isOwner,
  override_eligibility: isOwner,
  purge_account: isOwner,
  transfer_ownership: isOwner,
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
  // Payload-layer guard (role field access). The Owner may set any role via the CMS
  // fallback. In-app Admin/Head-Admin management (which also depends on the Head Admin
  // DESIGNATION) is enforced in the staff-roles service, not here.
  if (isOwner(actorRoles)) return [OWNER, ADMIN, MEMBER]
  return []
}
