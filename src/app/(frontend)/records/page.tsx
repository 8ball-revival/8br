import type { Metadata } from 'next'

import { ComingSoon } from '@/components/coming-soon'

export const metadata: Metadata = {
  title: 'Records',
  description: 'All-time records, milestones, and historical statistics.',
  alternates: { canonical: '/records' },
}

export default function RecordsPage() {
  return (
    <ComingSoon
      title="Records"
      description="All-time records, streaks, milestones, and historical statistics spanning two decades of competition."
    />
  )
}
