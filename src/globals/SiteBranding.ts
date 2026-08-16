import type { GlobalConfig } from 'payload'

import { adminOnly } from '@/collections/access'
import { revalidatePublicSite } from './revalidate'

/**
 * Site branding — the identity shown in the global header.
 *
 * A Payload singleton with drafts enabled, so an admin can stage a change (Save Draft) and only
 * make it live when they hit Publish. The public site reads the PUBLISHED version only; see
 * `src/lib/site-content/service.ts`.
 *
 * Scope is deliberately narrow: content only. There is no field here for font size, colour,
 * spacing or layout — the header design is fixed in code and admins edit what it says, not how it
 * looks.
 */
export const SiteBranding: GlobalConfig = {
  slug: 'site-branding',
  label: 'Site Branding',
  admin: {
    group: 'Site Content',
    description:
      'The site name and logo shown in the header. Save Draft to stage changes; Publish to make them live.',
  },
  access: {
    // Anonymous visitors may read. Payload still only exposes the published version to a
    // non-authenticated request; draft/version data is gated by readVersions below.
    read: () => true,
    // Creating drafts, changing the logo and publishing are all `update` on a global.
    update: adminOnly,
    // Draft + version history (including unpublished wording) is admin-only.
    readVersions: adminOnly,
  },
  versions: {
    drafts: true,
    // Keep a deep history so an admin can restore an older published version.
    max: 50,
  },
  hooks: {
    afterChange: [revalidatePublicSite],
  },
  fields: [
    {
      name: 'siteName',
      type: 'text',
      required: true,
      defaultValue: '8 Ball Registry',
      admin: { description: 'Wordmark text shown beside the logo in the header.' },
    },
    {
      name: 'logo',
      type: 'upload',
      relationTo: 'media',
      admin: { description: 'Header logo. Rendered at a fixed height; aspect ratio is preserved.' },
    },
    {
      name: 'logoAlt',
      type: 'text',
      admin: {
        description:
          'Alternative text for the logo. Leave blank if the logo is purely decorative next to the site name (screen readers will then read the site name only).',
      },
    },
  ],
}
