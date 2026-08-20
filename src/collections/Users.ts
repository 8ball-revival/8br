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
    /*
     * How long a session lasts.
     *
     * Payload's default is 7200 seconds — two hours — and this collection never set it, so every
     * signed-in person was quietly logged out two hours after signing in no matter what they were
     * doing. Nothing refreshed the token either, so being mid-way through building a bracket did
     * not help: the wall arrived on a fixed clock from the moment of login.
     *
     * Thirty days, with SessionKeepalive sliding it forward while somebody is actually using the
     * site. That means an active person is never interrupted, and an abandoned session on a shared
     * machine still dies within a month rather than living forever.
     */
    tokenExpiration: 60 * 60 * 24 * 30,
    loginWithUsername: {
      allowEmailLogin: true,
      requireEmail: true,
    },
    // Password recovery: send a link to the public frontend reset page (NOT the admin
    // panel), so members reset without ever seeing the CMS. Delivery uses the email
    // adapter configured in payload.config.ts (Resend).
    forgotPassword: {
      generateEmailSubject: () => 'Reset your 8 Ball Registry password',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      generateEmailHTML: (args: any) => {
        const token = (args?.token as string) ?? ''
        const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
        const url = `${base}/reset-password?token=${encodeURIComponent(token)}`
        return `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
            <h1 style="font-size:20px;margin:0 0 12px">Reset your password</h1>
            <p style="margin:0 0 16px;line-height:1.5;color:#444">
              We received a request to reset the password for your 8 Ball Registry account. Click the
              button below to choose a new password. This link expires in 1 hour.
            </p>
            <p style="margin:0 0 24px">
              <!-- Email clients do not support CSS variables, so the brand gold is inlined as the
                   sRGB equivalent of the --gold token, oklch(0.8 0.125 84), with the same dark ink
                   (--primary-foreground) the app uses on gold. Keep in step with globals.css. -->
              <a href="${url}" style="display:inline-block;background:#e4b756;color:#161107;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px">Reset password</a>
            </p>
            <p style="margin:0 0 8px;font-size:12px;color:#666">Or paste this link into your browser:</p>
            <p style="margin:0 0 24px;font-size:12px;word-break:break-all"><a href="${url}" style="color:#0a58ca">${url}</a></p>
            <p style="margin:0;font-size:12px;color:#666">If you didn't request this, you can safely ignore this email — your password won't change.</p>
          </div>`
      },
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
      // IDENTITY GUARD. `username` is the login PROJECTION of the canonical CueVerse ID and is never
      // independently editable — it is written ONLY by the central identity service (which sets
      // req.context.allowIdentitySync). This blocks the Payload admin panel, the REST/local API, and
      // any other path from changing the username so it can never diverge from the CueVerse ID.
      async ({ operation, data, req, originalDoc }) => {
        if (operation !== 'update') return data
        if (data?.username == null) return data
        if (data.username === originalDoc?.username) return data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((req.context as any)?.allowIdentitySync) return data
        throw new Error('Usernames are derived from the CueVerse ID and cannot be edited directly. Change the CueVerse ID instead.')
      },
      // Bootstrap: the very first account created on a fresh database becomes the
      // OWNER, so a brand-new deployment has a usable top-level admin without manual
      // DB work (created through Payload's secure first-user onboarding — the human
      // sets the password; it is never hardcoded). Every subsequent account defaults
      // to `member`, and only an Owner can elevate roles (field access below).
      async ({ operation, data, req }) => {
        if (operation === 'create') {
          const { totalDocs } = await req.payload.count({ collection: 'users' })
          if (totalDocs === 0) {
            // First-ever account = the Owner — but ONLY through the guarded /setup flow,
            // which sets req.context.allowBootstrap after validating the optional SETUP_SECRET.
            // This closes BOTH Payload's /admin "create first user" screen AND public signup
            // from silently claiming ownership on a fresh database.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (!(req.context as any)?.allowBootstrap) {
              throw new Error('Account creation is locked until the first administrator is created. Visit /setup to create the owner account.')
            }
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
    afterChange: [
      // Every account = one Player profile (the canonical competitive identity carrying the
      // CueVerse ID that team rosters, entrant lists and rankings resolve against). The public
      // registration flow creates the profile itself (preserving the chosen CueVerse ID casing)
      // and sets `skipAutoProfile` so we don't double-create. Accounts made directly in the
      // Payload admin panel have no such step — so we back-fill a linked profile here, using the
      // username as the initial CueVerse ID. Idempotent: a no-op when a profile already exists.
      async ({ doc, operation, req }) => {
        if (operation !== 'create') return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((req.context as any)?.skipAutoProfile) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userId = Number((doc as any)?.id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const username = (doc as any)?.username
        if (!Number.isFinite(userId) || !username) return
        const { createOrLinkAccountProfile } = await import('@/lib/players/service')
        await createOrLinkAccountProfile(userId, String(username)).catch(() => {})
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
