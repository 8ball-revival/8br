import type { Metadata } from 'next'

import { ComingSoon } from '@/components/coming-soon'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with 8 Ball Revival.',
  alternates: { canonical: '/contact' },
}

export default function ContactPage() {
  return <ComingSoon title="Contact" description="Ways to reach the team — coming soon." />
}
