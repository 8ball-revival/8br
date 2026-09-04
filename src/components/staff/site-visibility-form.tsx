'use client'

import { useActionState, useState } from 'react'
import { Globe, Loader2, ShieldCheck } from 'lucide-react'

import { saveSiteVisibility } from '@/lib/auth/visibility-actions'
import type { SiteVisibility } from '@/lib/auth/site-visibility'

/**
 * The switch that opens and closes the whole site.
 *
 * ── Why it states the consequence rather than the state ──────────────────────────────────────────
 * "Private" is not self-explanatory here: it does not mean members-only content or a hidden section,
 * it means every URL on the domain answers with a login page, including links people already hold
 * and anything a search engine has indexed. Somebody reaching for this at speed should be able to
 * read what will happen without opening documentation, so each option says what a stranger sees.
 *
 * ── Why there is no confirmation dialog ──────────────────────────────────────────────────────────
 * It is one click either way and the other click undoes it. A dialog on a reversible switch teaches
 * people to dismiss dialogs, which is worse than the thing it guards. What it does have is a plain
 * statement of effect, and an audit entry recording who flipped it.
 */
export function SiteVisibilityForm({ initial }: { initial: SiteVisibility }) {
  const [state, action, pending] = useActionState(saveSiteVisibility, null)
  /* The saved value wins once a save returns, so the control cannot drift from the server. */
  const [chosen, setChosen] = useState<SiteVisibility>(initial)
  const current = state?.visibility ?? chosen

  return (
    <form action={action} className="rounded-none border border-border bg-card/40 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-[var(--gold)]" aria-hidden />
        <h2 className="font-medium">Site Visibility</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Whether the site can be read without signing in. This applies to every page and every API
        route, not just the home page.
      </p>

      <fieldset className="mt-4">
        <legend className="sr-only">Site visibility</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            {
              id: 'PUBLIC' as const,
              icon: Globe,
              title: 'Public',
              blurb: 'Anyone can read the site. Pages are indexable and the sitemap is served.',
            },
            {
              id: 'PRIVATE' as const,
              icon: ShieldCheck,
              title: 'Private',
              blurb: 'Every page and API route requires a sign-in. Crawling is refused and the sitemap is empty.',
            },
          ]).map(({ id, icon: Icon, title, blurb }) => (
            <label
              key={id}
              className={`flex cursor-pointer gap-2.5 rounded-md border p-3 transition-colors ${
                current === id
                  ? 'border-[var(--gold)]/50 bg-[var(--selected-surface)]'
                  : 'border-border hover:border-brand/40'
              }`}
            >
              <input
                type="radio"
                name="siteVisibility"
                value={id}
                checked={current === id}
                onChange={() => setChosen(id)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium">
                  <Icon className="size-3.5" aria-hidden />
                  {title}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/*
        Said before the click, not after.

        Closing the site is the kind of change whose effect people discover from somebody else, so
        the consequence that reaches beyond this screen — old links, search results — is spelled out
        while the choice is still being made.
      */}
      {current === 'PRIVATE' && (
        <p className="mt-3 text-xs text-muted-foreground">
          Existing links and bookmarks will lead to the sign-in page. Pages already held by a search
          engine are not removed by this — that needs a removal request.
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Save
        </button>
        {state?.ok && !pending && (
          <span className="text-xs text-muted-foreground" role="status">
            Saved — the site is now {state.visibility === 'PRIVATE' ? 'private' : 'public'}.
          </span>
        )}
        {state?.error && (
          <span className="text-xs text-[var(--loss)]" role="alert">{state.error}</span>
        )}
      </div>
    </form>
  )
}
