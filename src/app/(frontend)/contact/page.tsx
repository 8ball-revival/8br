import type { Metadata } from 'next'

import { ComingSoon } from '@/components/coming-soon'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with World Cue Championships.',
  alternates: { canonical: '/contact' },
}

export default function ContactPage() {
  return <ComingSoon title="Contact" description="Ways to reach the team — coming soon." />
}
