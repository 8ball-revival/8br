import type { Metadata } from 'next'

import { ComingSoon } from '@/components/coming-soon'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms of service for World Cue Championships.',
  alternates: { canonical: '/terms' },
}

export default function TermsPage() {
  return <ComingSoon title="Terms of Service" description="Our terms of service — coming soon." />
}
