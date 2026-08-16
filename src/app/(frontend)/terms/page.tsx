import type { Metadata } from 'next'

import { ComingSoon } from '@/components/coming-soon'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms of service for 8 Ball Registry.',
  alternates: { canonical: '/terms' },
}

export default function TermsPage() {
  return <ComingSoon title="Terms of Service" description="Our terms of service — coming soon." />
}
