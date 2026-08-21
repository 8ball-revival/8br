import type { GlobalConfig } from 'payload'

import { adminOnly } from '@/collections/access'
import { validateLinkDestination } from '@/lib/site-content/link'
import { revalidatePublicSite } from './revalidate'

/**
 * Homepage hero — the banner image and the wording laid over it.
 *
 * A Payload singleton with drafts enabled: Save Draft stages a change without touching the public
 * homepage, Publish makes it live, and version history lets an admin restore an earlier published
 * version. The public site reads the PUBLISHED version only.
 *
 * Content only, by design. The hero's typography, colours, spacing and responsive behaviour are
 * fixed in `src/app/(frontend)/page.tsx`; the fields below change what it says, which image sits
 * behind it, and where the two buttons point — never how it looks.
 */
export const HomepageHero: GlobalConfig = {
  slug: 'homepage-hero',
  label: 'Homepage Hero',
  admin: {
    group: 'Site Content',
    description:
      'The homepage banner and its wording. Save Draft to stage changes; Publish to make them live.',
  },
  access: {
    read: () => true,
    update: adminOnly,
    readVersions: adminOnly,
  },
  versions: {
    drafts: true,
    max: 50,
  },
  hooks: {
    afterChange: [revalidatePublicSite],
  },
  fields: [
    {
      type: 'collapsible',
      label: 'Banner image',
      fields: [
        {
          name: 'bannerImage',
          type: 'upload',
          relationTo: 'media',
          admin: {
            description:
              'Full-width hero image. Displayed edge-to-edge and cropped to the hero height, centred — use artwork whose subject sits near the middle.',
          },
        },
        {
          name: 'bannerAlt',
          type: 'text',
          admin: { description: 'Alternative text describing the banner for screen readers.' },
        },
      ],
    },
    {
      type: 'collapsible',
      label: 'Hero text',
      fields: [
        {
          name: 'welcomeLine',
          type: 'text',
          admin: { description: 'Small gold line above the headline. Rendered in uppercase.' },
        },
        {
          name: 'headlineLine1',
          type: 'text',
          admin: { description: 'First line of the headline (white). Rendered in uppercase.' },
        },
        {
          name: 'headlineLine2',
          type: 'text',
          admin: { description: 'Second line of the headline (gold). Rendered in uppercase.' },
        },
        {
          name: 'description',
          type: 'textarea',
          admin: { description: 'Main paragraph under the headline.' },
        },
        {
          name: 'supportingSentence',
          type: 'text',
          admin: { description: 'Short closing sentence under the description.' },
        },
      ],
    },
    {
      type: 'collapsible',
      label: 'Buttons',
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'primaryButtonLabel',
              type: 'text',
              admin: { width: '50%', description: 'First button label.' },
            },
            {
              name: 'primaryButtonHref',
              type: 'text',
              validate: validateLinkDestination,
              admin: {
                width: '50%',
                description: 'First button destination — a site path like /seasons, or https://…',
              },
            },
          ],
        },
        {
          type: 'row',
          fields: [
            {
              name: 'secondaryButtonLabel',
              type: 'text',
              admin: { width: '50%', description: 'Second button label.' },
            },
            {
              name: 'secondaryButtonHref',
              type: 'text',
              validate: validateLinkDestination,
              admin: {
                width: '50%',
                description:
                  'Second button destination — a site path like /tournaments, or https://…',
              },
            },
          ],
        },
      ],
    },
  ],
}
