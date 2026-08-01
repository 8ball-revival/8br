import type { Metadata } from 'next'

import { ComingSoon } from '@/components/coming-soon'

export const metadata: Metadata = {
  title: 'About',
  description: 'About 8 Ball Revival.',
  alternates: { canonical: '/about' },
}

export default function AboutPage() {
  return <ComingSoon title="About 8 Ball Revival" description="The story of the community — coming soon." />
}
