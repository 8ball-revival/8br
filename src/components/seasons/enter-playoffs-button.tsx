'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { enterSeasonPlayoffSetupAction } from '@/lib/seasons/actions'

/** GROUPS_CLOSED → open playoff setup (auto-selects the top-three qualifiers per group). */
export function EnterPlayoffsButton({ seasonId }: { seasonId: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      className="bg-[#d6ae42] text-black hover:bg-[#e6c463]"
      disabled={pending}
      onClick={() => start(async () => { const r = await enterSeasonPlayoffSetupAction(seasonId); if (!r.error) router.refresh() })}
    >
      <Trophy className="size-4" /> Playoff Brackets
    </Button>
  )
}
