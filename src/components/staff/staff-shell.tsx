import Link from 'next/link'
import { LayoutDashboard, Settings, Users, Grid3x3, Swords, ListOrdered, Trophy, ScrollText } from 'lucide-react'

import { cn } from '@/lib/utils'

export type StaffSection =
  | 'dashboard'
  | 'season'
  | 'registrations'
  | 'groups'
  | 'matches'
  | 'standings'
  | 'playoffs'
  | 'audit'

const NAV: { key: StaffSection; label: string; href: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/staff', icon: LayoutDashboard },
  { key: 'season', label: 'Season', href: '/staff/season', icon: Settings },
  { key: 'registrations', label: 'Registrations', href: '/staff/registrations', icon: Users },
  { key: 'groups', label: 'Groups', href: '/staff/groups', icon: Grid3x3 },
  { key: 'matches', label: 'Matches', href: '/staff/matches', icon: Swords },
  { key: 'standings', label: 'Standings', href: '/staff/standings', icon: ListOrdered },
  { key: 'playoffs', label: 'Playoffs', href: '/staff/playoffs', icon: Trophy },
  { key: 'audit', label: 'Audit log', href: '/staff/audit', icon: ScrollText },
]

/** Competition-admin chrome: sidebar nav + header. Server-rendered; `active` sets highlight. */
export function StaffShell({
  active,
  username,
  seasonName,
  children,
}: {
  active: StaffSection
  username: string
  seasonName?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
      <aside className="border-b border-border lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
        <div className="p-4">
          <Link href="/staff" className="flex items-center gap-2">
            <span className="inline-block size-4 rotate-45 rounded-[3px] bg-gradient-to-br from-gold-soft to-gold-dim" aria-hidden />
            <span className="font-display font-bold tracking-tight">8 Ball Revival Admin</span>
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">Competition administration</p>
        </div>
        <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
          {NAV.map((item) => {
            const isActive = item.key === active
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
          <p className="text-sm text-muted-foreground">
            {seasonName ? (
              <>
                Operating <span className="font-medium text-foreground">{seasonName}</span>
              </>
            ) : (
              'No active season'
            )}
          </p>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{username}</span>
            </span>
            <Link href="/" className="text-gold hover:text-gold-soft">
              View site
            </Link>
            <Link href="/admin" className="text-muted-foreground hover:text-foreground">
              CMS
            </Link>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
