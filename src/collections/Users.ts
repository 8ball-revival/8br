import type { CollectionConfig } from 'payload'
import { isStaffUser, isOwnerUser, ownerFieldOnly } from './access'
import { ROLE_OPTIONS } from '@/lib/auth/roles'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'username',
    // Only staff may access the Payload admin panel; normal members cannot.
    hidden: ({ user }) => !isStaffUser(user),
  },
  // Native username login (User ID). Email is still required + used for recovery,
  // but is NOT public. Email verification is intentionally DISABLED for launch.
  auth: {
    loginWithUsername: {
      allowEmailLogin: true,
      requireEmail: true,
    },
  },
  access: {
    // Only staff can reach the admin panel.
    admin: ({ req }) => isStaffUser(req?.user),
    // Staff read all accounts (needed for the Staff list); members read their own.
    read: ({ req }) => (isStaffUser(req?.user) ? true : { id: { equals: req?.user?.id } }),
    // Staff-account creation via the panel/API is Owner-only. Public member signup
    // uses the local API with overrideAccess, and Payload's first-user onboarding
    // bypasses this — so a fresh DB can still bootstrap the first Owner.
    create: ({ req }) => isOwnerUser(req?.user),
    // Owners may edit any account; everyone else only their own profile. (The
    // `roles` field is separately Owner-gated below.)
    update: ({ req }) => (isOwnerUser(req?.user) ? true : { id: { equals: req?.user?.id } }),
    // Only an Owner may delete accounts.
    delete: ({ req }) => isOwnerUser(req?.user),
  },
  hooks: {
    beforeChange: [
      // Bootstrap: the very first account created on a fresh database becomes the
      // OWNER, so a brand-new deployment has a usable top-level admin without manual
      // DB work (created through Payload's secure first-user onboarding — the human
      // sets the password; it is never hardcoded). Every subsequent account defaults
      // to `member`, and only an Owner can elevate roles (field access below).
      async ({ operation, data, req }) => {
        if (operation === 'create') {
          const { totalDocs } = await req.payload.count({ collection: 'users' })
          if (totalDocs === 0) {
            data.roles = ['owner']
          }
        }
        return data
      },
      // OWNER PROTECTION. Ownership is singular and can change ONLY through the
      // explicit transfer flow (which sets req.context.allowOwnerTransfer). Outside
      // that flow: the Owner cannot be demoted, and Owner cannot be granted to anyone
      // else — so no account can silently gain or lose ownership. The first-user
      // bootstrap above is exempt (there is no Owner yet).
      async ({ operation, data, req, originalDoc }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((req.context as any)?.allowOwnerTransfer) return data
        const hadOwner = Array.isArray(originalDoc?.roles) && originalDoc.roles.includes('owner')
        const willOwner = Array.isArray(data?.roles) && data.roles.includes('owner')
        if (operation === 'update') {
          if (hadOwner && !willOwner)
            throw new Error('The Owner cannot be demoted. Transfer ownership first.')
          if (!hadOwner && willOwner)
            throw new Error('Owner can only be granted by transferring ownership.')
        }
        if (operation === 'create' && willOwner) {
          const { totalDocs } = await req.payload.count({ collection: 'users' })
          if (totalDocs > 0) throw new Error('Owner can only be granted by transferring ownership.')
        }
        return data
      },
    ],
    beforeDelete: [
      // The Owner account can never be deleted (transfer ownership first, which
      // demotes the former Owner to Admin — an Admin account is deletable).
      async ({ req, id }) => {
        const doc = await req.payload.findByID({ collection: 'users', id, overrideAccess: true }).catch(() => null)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (doc && Array.isArray((doc as any).roles) && (doc as any).roles.includes('owner'))
          throw new Error('The Owner account cannot be deleted. Transfer ownership first.')
      },
      // BACKSTOP: a hard delete must never leave the account entered in a live competition.
      // The shared registration-cleanup withdraws only ACTIVE participation in non-completed
      // competitions (completed history is preserved). Runs after the owner guard above.
      async ({ req, id }) => {
        const uid = Number(id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actorId = Number((req?.user as any)?.id) || uid
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actorName = (req?.user as any)?.username ?? 'system'
        const { cleanupActiveRegistrations } = await import('@/lib/competition/cleanup')
        await cleanupActiveRegistrations({ userId: actorId, username: actorName }, uid, 'Account deleted (Payload delete backstop)')
      },
    ],
  },
  fields: [
    // `username` (User ID) + `email` + auth fields are added by Payload auth.
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      defaultValue: ['member'],
      // Only an Owner may create/change roles (prevents self-escalation to staff
      // and blocks anyone below Owner from granting Owner/Admin access).
      access: { create: ownerFieldOnly, update: ownerFieldOnly },
      options: ROLE_OPTIONS,
    },
  ],
}
