import Link from 'next/link'
import { ShieldCheck, LayoutDashboard, Users2, Trophy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ActionButton } from '@/components/staff/action-button'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { prisma } from '@/lib/prisma'
import { publishGroupsAction, unpublishGroupsAction } from '@/lib/competition/actions'

type Surface = 'groups' | 'playoffs' | 'cups'

/**
 * Inline management controls integrated into the PUBLIC competition pages, rendered
 * only for Owner/Admin (any member — signed-in or not — gets `null`). The same
 * public page therefore serves members the published content and staff the
 * management controls, reusing the existing group/playoff/publish services. All
 * actions are still enforced server-side (`manage_competitions`).
 */
export async function AdminBar({ surface, seasonId }: { surface: Surface; seasonId?: number }) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok' || !access.actor.can('manage_competitions')) return null

  const dashHref = seasonId ? `/staff/competition/${seasonId}` : '/staff'

  let groupState: { count: number; published: boolean } | null = null
  if (surface === 'groups' && seasonId != null) {
    const [count, publishedCount] = await Promise.all([
      prisma.seasonGroup.count({ where: { seasonId } }),
      prisma.seasonGroup.count({ where: { seasonId, published: true } }),
    ])
    groupState = { count, published: publishedCount > 0 }
  }

  return (
    <div className="mb-6 rounded-lg border border-gold/30 bg-gold/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="gold" className="gap-1">
          <ShieldCheck className="size-3.5" aria-hidden /> Admin
        </Badge>

        <Button asChild size="sm" variant="secondary">
          <Link href={dashHref}>
            <LayoutDashboard className="size-4" aria-hidden /> Open Competition Dashboard
          </Link>
        </Button>

        {surface === 'groups' && seasonId != null && (
          <>
            <Button asChild size="sm">
              <Link href="/groups?edit=true">
                <Users2 className="size-4" aria-hidden /> {groupState && groupState.count === 0 ? 'Create Groups' : 'Edit Groups'}
              </Link>
            </Button>
            {groupState && groupState.count > 0 && !groupState.published && (
              <ActionButton
                action={publishGroupsAction}
                fields={{ seasonId }}
                label="Publish"
                confirm="Publish groups? They become public and round-robin fixtures are generated. Empty groups and double-assigned players are blocked."
              />
            )}
            {groupState && groupState.published && (
              <ActionButton
                action={unpublishGroupsAction}
                fields={{ seasonId }}
                label="Unpublish"
                variant="outline"
                confirm="Unpublish groups? They will be hidden from the public site (only allowed before any result is recorded)."
              />
            )}
          </>
        )}

        {surface === 'playoffs' && (
          <Button asChild size="sm">
            <Link href="/playoffs?edit=true">
              <Trophy className="size-4" aria-hidden /> Create / Edit Bracket
            </Link>
          </Button>
        )}

        {surface === 'cups' && (
          <Button asChild size="sm" variant="outline">
            <Link href="/cups">
              <Trophy className="size-4" aria-hidden /> Manage Cups
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}
