import type { CollectionConfig } from 'payload'
import { isStaffUser, adminFieldOnly } from './access'

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
    // Users read their own record; staff read all. (Public signup uses the local API
    // with overrideAccess, so this does not block account creation.)
    read: ({ req }) => (isStaffUser(req?.user) ? true : { id: { equals: req?.user?.id } }),
    create: ({ req }) => isStaffUser(req?.user),
    update: ({ req }) => (isStaffUser(req?.user) ? true : { id: { equals: req?.user?.id } }),
    delete: ({ req }) => isStaffUser(req?.user),
  },
  hooks: {
    beforeChange: [
      // Bootstrap: the very first user created on a fresh database becomes an
      // admin, so a brand-new deployment has a usable admin without manual DB work.
      // (The `roles` field is admin-gated, so first-register would otherwise produce
      // a locked-out member.) Every subsequent account defaults to `member`.
      async ({ operation, data, req }) => {
        if (operation === 'create') {
          const { totalDocs } = await req.payload.count({ collection: 'users' })
          if (totalDocs === 0) {
            data.roles = ['admin']
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
      // Only admins may change roles (prevents self-escalation to staff).
      access: { create: adminFieldOnly, update: adminFieldOnly },
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Senior Editor', value: 'senior_editor' },
        { label: 'Editor', value: 'editor' },
        { label: 'Member', value: 'member' },
      ],
    },
  ],
}
