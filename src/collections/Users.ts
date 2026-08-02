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
