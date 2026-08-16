import type { Metadata } from 'next'

import { ComingSoon } from '@/components/coming-soon'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy policy for 8 Ball Registry.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return <ComingSoon title="Privacy Policy" description="Our privacy policy — coming soon." />
}
