import type { Metadata } from 'next'
import { getPayload } from 'payload'
import config from '@payload-config'

import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { ActionButton } from '@/components/staff/action-button'
import { AccountLinkSelect, EditProfileForm, CreateProfileForm } from '@/components/staff/link-controls'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getUnlinkedProfiles, getProfileCounts } from '@/lib/players/service'
import { getUnlinkedAccounts } from '@/lib/players/accounts'
import { linkAccountAction, unlinkAccountAction } from '@/lib/players/actions'
import { prisma } from '@/lib/prisma'

export const metadata: Metadata = { title: 'Players · Admin · 8 Ball Revival', robots: { index: false, follow: false } }

type SP = { searchParams: Promise<{ aq?: string; pq?: string }> }

export default async function PlayersStaffPage({ searchParams }: SP) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_players'))
    return <StaffDenied active="players" username={access.actor.username} label="Players" />

  const { aq = '', pq = '' } = await searchParams
  const [counts, unlinkedAccounts, unlinkedProfiles] = await Promise.all([
    getProfileCounts(),
    getUnlinkedAccounts(aq),
    getUnlinkedProfiles(pq),
  ])
  const accountsSlim = unlinkedAccounts.map((a) => ({ userId: a.userId, username: a.username }))

  // Claimed profiles + their account usernames.
  const claimed = await prisma.player.findMany({ where: { linkedUserId: { not: null } }, orderBy: { linkedAt: 'desc' }, take: 50 })
  const p = await getPayload({ config: await config })
  const usernameById = new Map<string, string>()
  if (claimed.length) {
    const users = await p.find({ collection: 'users', where: { id: { in: claimed.map((c) => c.linkedUserId!) } }, overrideAccess: true, limit: 100 })
    for (const u of users.docs as { id: string | number; username?: string }[]) usernameById.set(String(u.id), String(u.username ?? ''))
  }

  return (
    <StaffShell active="players" username={access.actor.username}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Players & Profile Linking</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {counts.total} profiles · {counts.claimed} claimed · {counts.unclaimed} unclaimed · {counts.needsPrimaryReview} need
        primary-ID review. Link accounts to their canonical competitive identity. Suggestions are informational — linking
        always requires this staff action.
      </p>

      {/* Accounts awaiting a profile link */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Accounts awaiting a link ({unlinkedAccounts.length})</h2>
          <form method="get" className="flex gap-2">
            {pq && <input type="hidden" name="pq" value={pq} />}
            <Input name="aq" defaultValue={aq} placeholder="Search accounts…" className="w-52" />
            <Button type="submit" variant="outline" size="sm">Search</Button>
          </form>
        </div>
        <div className="mt-3 space-y-3">
          {unlinkedAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No unlinked accounts.</p>
          ) : (
            unlinkedAccounts.map((a) => (
              <div key={a.userId} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-semibold text-foreground">{a.username}</span>
                  {a.displayName && <span className="text-muted-foreground">“{a.displayName}”</span>}
                  {a.cueverseId && <span className="text-muted-foreground">· {a.cueverseId}</span>}
                  {a.discord && <span className="text-muted-foreground">· 💬 {a.discord}</span>}
                </div>
                <div className="mt-2">
                  {a.suggestions.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-muted-foreground">Suggested:</span>
                      {a.suggestions.map((s) => (
                        <span key={s.profile.id} className="inline-flex items-center gap-1.5">
                          <ActionButton
                            action={linkAccountAction}
                            fields={{ userId: a.userId, playerId: s.profile.id }}
                            label={`Link → ${s.profile.primaryName}${s.profile.cueverseId ? ` (${s.profile.cueverseId})` : ''}`}
                            variant="secondary"
                          />
                          <span className="rounded bg-success/10 px-1.5 py-0.5 text-[0.6rem] font-medium tracking-wide text-success uppercase">
                            {s.matchedOn.join(' + ')} match
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No suggested match — find the profile below and link it to this account.
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Unclaimed profiles */}
      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Unclaimed profiles</h2>
          <form method="get" className="flex gap-2">
            {aq && <input type="hidden" name="aq" value={aq} />}
            <Input name="pq" defaultValue={pq} placeholder="Name, CueVerse ID, Discord, alias…" className="w-64" />
            <Button type="submit" variant="outline" size="sm">Search</Button>
          </form>
        </div>
        <div className="mt-3 space-y-3">
          {unlinkedProfiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">{pq ? 'No profiles match.' : 'Search to find profiles.'}</p>
          ) : (
            unlinkedProfiles.map((pr) => (
              <div key={pr.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-semibold text-foreground">{pr.primaryName}</span>
                  {pr.cueverseId ? (
                    <span className="text-gold">Primary: {pr.cueverseId}</span>
                  ) : (
                    <Badge variant="gold">Primary ID: needs review</Badge>
                  )}
                  {pr.legacyPlayerId && <span className="text-xs text-muted-foreground">[{pr.legacyPlayerId}]</span>}
                  {!pr.active && <Badge variant="muted">Inactive</Badge>}
                </div>
                {pr.aliases.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="tracking-wide text-[0.6rem] text-muted-foreground/70 uppercase">Internal aliases (identity resolution — never shown publicly):</span>{' '}
                    {pr.aliases.join(', ')}
                  </p>
                )}
                <div className="mt-2"><AccountLinkSelect playerId={pr.id} accounts={accountsSlim} /></div>
                <EditProfileForm profile={{ id: pr.id, primaryName: pr.primaryName, cueverseId: pr.cueverseId, discord: pr.discord, timeZone: pr.timeZone, active: pr.active }} />
              </div>
            ))
          )}
        </div>
      </section>

      {/* Claimed profiles */}
      {claimed.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold">Claimed profiles ({claimed.length})</h2>
          <div className="mt-3 space-y-2">
            {claimed.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-4 py-2.5 text-sm">
                <span>
                  <span className="font-semibold text-foreground">{c.primaryName}</span>
                  {c.cueverseId && <span className="text-muted-foreground"> ({c.cueverseId})</span>}
                  <span className="text-muted-foreground"> — owned by </span>
                  <span className="font-medium text-gold">{usernameById.get(c.linkedUserId!) ?? `account ${c.linkedUserId}`}</span>
                </span>
                <ActionButton action={unlinkAccountAction} fields={{ playerId: c.id }} label="Unlink" variant="outline" confirm="Unlink this account from the profile? Historical data is kept." />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Create a profile manually */}
      <section className="mt-10 max-w-lg">
        <h2 className="font-display text-lg font-semibold">Create a profile</h2>
        <CreateProfileForm />
      </section>
    </StaffShell>
  )
}
