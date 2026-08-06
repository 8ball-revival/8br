import Link from 'next/link'
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  UserCog,
  Gavel,
  CalendarRange,
  Trophy,
  Swords,
  ShieldCheck,
  ScrollText,
  ShieldAlert,
  KeyRound,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { getCurrentUser } from '@/lib/account/auth'
import { can, type Capability } from '@/lib/auth/roles'

export type StaffSection =
  | 'dashboard'
  | 'registrations'
  | 'members'
  | 'penalties'
  | 'players'
  | 'accounts'
  | 'seasons'
  | 'cups'
  | 'matches'
  | 'staff'
  | 'audit'

// Nav items gated by capability (undefined = any staff). Server-side page guards
// enforce the same matrix — the nav only hides what the user can't reach.
const NAV: { key: StaffSection; label: string; href: string; icon: typeof LayoutDashboard; cap?: Capability }[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/staff', icon: LayoutDashboard },
  { key: 'registrations', label: 'Registrations', href: '/staff/registrations', icon: ClipboardList, cap: 'manage_registrations' },
  { key: 'members', label: 'Members', href: '/staff/members', icon: UserCog, cap: 'moderate_members' },
  { key: 'penalties', label: 'Penalties', href: '/staff/penalties', icon: Gavel, cap: 'moderate_members' },
  { key: 'players', label: 'Players', href: '/staff/players', icon: Users, cap: 'manage_players' },
  { key: 'accounts', label: 'Accounts', href: '/staff/accounts', icon: KeyRound, cap: 'manage_players' },
  { key: 'seasons', label: 'Seasons', href: '/staff/seasons', icon: CalendarRange, cap: 'manage_competitions' },
  { key: 'cups', label: 'Cups', href: '/cups', icon: Trophy, cap: 'manage_competitions' },
  { key: 'matches', label: 'Matches', href: '/staff/matches', icon: Swords, cap: 'edit_results' },
  { key: 'staff', label: 'Staff', href: '/staff/staff', icon: ShieldCheck, cap: 'manage_staff' },
  { key: 'audit', label: 'Audit Log', href: '/staff/audit', icon: ScrollText, cap: 'view_audit' },
]

/** Competition-admin chrome: sidebar nav + header. Nav is filtered by the signed-in
 *  staff member's capabilities (resolved here from the Payload session). */
export async function StaffShell({
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
  const user = await getCurrentUser()
  const roles = user?.roles ?? []
  const nav = NAV.filter((item) => !item.cap || can(roles, item.cap))

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
          {nav.map((item) => {
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

/** Signed-in staff who lack the capability for a section (server-side denial). */
export async function StaffDenied({
  active,
  username,
  label,
}: {
  active: StaffSection
  username: string
  label: string
}) {
  return (
    <StaffShell active={active} username={username}>
      <div className="mx-auto flex max-w-md flex-col items-center justify-center py-24 text-center">
        <span className="flex size-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
          <ShieldAlert className="size-6" aria-hidden />
        </span>
        <h1 className="mt-5 font-display text-xl font-bold tracking-tight">Insufficient permissions</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your role doesn&apos;t have access to {label}. Ask an Owner if you need it.
        </p>
      </div>
    </StaffShell>
  )
}
