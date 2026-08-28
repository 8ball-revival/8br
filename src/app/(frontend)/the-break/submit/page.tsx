import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, MessageSquareOff } from 'lucide-react'

import { prisma } from '@/lib/prisma'
import { currentBreakActor, canPost, canMarkOfficial } from '@/lib/break/permissions'
import { PostEditor } from '@/components/break/post-editor'

export const dynamic = 'force-dynamic'

/**
 * Writing a post.
 *
 * ── Why this file did not exist ──────────────────────────────────────────────────────────────────
 * The feed's Create Post button has always pointed at `/the-break/submit`, and there has never been
 * a route here. Next matched `/the-break/[slug]` instead, found no post with the slug "submit", and
 * rendered the not-found page — so every member who pressed the button got a 404. The permission
 * model said anyone could post; the site had no way to.
 *
 * ── The gate is the same predicate the action uses ───────────────────────────────────────────────
 * `canPost`, in both places. This one decides whether the page draws a composer; `createPostAction`
 * decides whether the write is accepted, and it is the one that matters — a server action is a
 * public endpoint, and a form that is not rendered stops nobody.
 *
 * ── A refusal here is explained, not hidden ──────────────────────────────────────────────────────
 * The edit page uses `notFound()` for somebody who may not edit a post, because "you may not edit
 * this" confirms the post exists and is worth probing. That reasoning does not apply here: there is
 * nothing to conceal, and the person reading is being told about their own account. Hiding it would
 * leave them pressing a button that silently does nothing.
 */
export default async function SubmitPostPage() {
  const actor = await currentBreakActor()
  if (!actor) redirect('/login?next=%2Fthe-break%2Fsubmit')

  const back = (
    <Link href="/the-break" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-4" aria-hidden /> Back to The Break
    </Link>
  )

  if (!canPost(actor)) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        {back}
        <div className="border border-[var(--hot-red)] bg-card p-5">
          <h1 className="flex items-center gap-2 font-display text-xl font-bold text-foreground">
            <MessageSquareOff className="size-5 text-[var(--hot-red)]" aria-hidden />
            Posting has been removed
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You can still read, comment, vote and save. Anything you have already posted is still up.
          </p>
          {actor.postingBlockedReason && (
            <p className="mt-3 border border-border bg-background px-3 py-2 text-sm text-foreground">
              <span className="font-medium">Reason given:</span> {actor.postingBlockedReason}
            </p>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            If you think this is wrong, reply to a moderator in a comment or use the contact link in
            the footer.
          </p>
        </div>
      </main>
    )
  }

  /*
   * Only the categories this actor may actually file under.
   *
   * Announcement is `adminOnly`, and the service refuses it for a member regardless — but offering
   * it and then rejecting the post after somebody has written it is a worse way to say the same
   * thing. Filtering here and enforcing there is the usual pairing: the list is a courtesy, the
   * refusal is the rule.
   */
  const categories = await prisma.breakCategory.findMany({
    where: { active: true, ...(actor.isAdmin ? {} : { adminOnly: false }) },
    select: { slug: true, name: true },
    orderBy: { id: 'asc' },
  })

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      {back}

      <h1 className="font-display text-xl font-bold text-foreground">New post</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Posting as <span className="font-medium text-foreground">{actor.handle ?? actor.name}</span>.
        Your post goes up straight away and you can edit or withdraw it afterwards.
      </p>

      <div className="mt-5 rounded-none border border-border bg-card p-4">
        <PostEditor
          mode="create"
          canMarkOfficial={canMarkOfficial(actor)}
          categories={categories}
          returnTo="/the-break"
          initial={{
            title: '',
            type: 'TEXT',
            linkUrl: null,
            spoiler: false,
            sensitive: false,
            official: false,
            bodySource: '',
            categorySlug: null,
          }}
        />
      </div>
    </main>
  )
}
