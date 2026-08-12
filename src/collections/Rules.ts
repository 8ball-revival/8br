import type { CollectionConfig } from 'payload'

/**
 * Rules & competition formats — Payload-owned editorial content (schema "payload").
 * Drafts/versions enabled so rule changes are audit-tracked over time.
 */
export const Rules: CollectionConfig = {
  slug: 'rules',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', 'effectiveFrom'],
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
    {
      name: 'category',
      type: 'select',
      defaultValue: 'general',
      options: ['general', 'tournament', 'cup', 'tournament', 'format', 'conduct'],
    },
    {
      name: 'appliesToCompetitionType',
      type: 'text',
      admin: { description: 'App-level reference to a CompetitionType code (Prisma), e.g. SEASON. Optional.' },
    },
    { name: 'content', type: 'richText' },
    { name: 'effectiveFrom', type: 'date' },
    { name: 'versionLabel', type: 'text' },
  ],
}
