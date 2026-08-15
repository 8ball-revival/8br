/** Client-safe Site Settings shape + field metadata (no server-only / no DB). */
export interface SiteSettings {
  siteName: string
  shortName: string
  description: string
  defaultLounge: string
  gameRoomLink: string
  contactEmail: string
  supportInfo: string
  homepageBanner: string
}

export const SETTINGS_FIELDS: { key: keyof SiteSettings; label: string; kind: 'text' | 'url' | 'email' | 'textarea'; hint?: string }[] = [
  { key: 'siteName', label: 'Site name', kind: 'text' },
  { key: 'shortName', label: 'Short name', kind: 'text' },
  { key: 'description', label: 'Short description', kind: 'textarea' },
  { key: 'defaultLounge', label: 'Default lounge', kind: 'text' },
  { key: 'gameRoomLink', label: 'Default game-room link', kind: 'url', hint: 'https://…' },
  { key: 'contactEmail', label: 'Contact email', kind: 'email' },
  { key: 'supportInfo', label: 'Support information', kind: 'textarea' },
  { key: 'homepageBanner', label: 'Homepage banner text', kind: 'textarea' },
]
