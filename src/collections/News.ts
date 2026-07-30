import type { CollectionConfig } from 'payload'

/**
 * News & announcements — Payload-owned editorial content (schema "payload").
 * Drafts/versions are enabled so every edit is audit-tracked.
 * References into the Prisma competition domain are stored as plain app-level
 * identifiers (no cross-ORM foreign keys).
 */
export const News: CollectionConfig = {
  slug: 'news',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'featured', 'publishedAt'],
  },
  access: {
    read: () => true,
  },
  versions: {
    drafts: true,
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'excerpt', type: 'textarea' },
    { name: 'content', type: 'richText' },
    { name: 'coverImage', type: 'upload', relationTo: 'media' },
    { name: 'featured', type: 'checkbox', defaultValue: false },
    { name: 'publishedAt', type: 'date' },
    {
      name: 'relatedCompetitionSlug',
      type: 'text',
      admin: { description: 'App-level reference to a Competition (Prisma) by slug. Optional.' },
    },
    {
      name: 'relatedPlayerLegacyId',
      type: 'text',
      admin: { description: 'App-level reference to a Player (Prisma) by legacy id, e.g. P1316. Optional.' },
    },
  ],
}
