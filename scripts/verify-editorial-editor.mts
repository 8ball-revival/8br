/**
 * The article editor's Owner-only controls, asserted against real rendered markup.
 *
 * The server already refuses to honour attribution or backdating from anybody who lacks the
 * permission — that is covered in verify-editorial. This checks the other half: that a browser
 * belonging to somebody without the permission never receives the controls, or the roster of
 * members that feeds them, in the first place. A hidden control is not a security boundary, but
 * shipping one to a person who cannot use it is still a leak of who else exists on the site.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-editorial-editor.mts
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArticleEditor, type EditorArticle, type EditorMember } from '../src/components/editorial/article-editor.tsx'
import { DialogProvider } from '../src/components/ui/confirm-dialog.tsx'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'

/**
 * The editor calls useRouter, which needs the app-router context that only exists inside a running
 * Next tree. A stub is enough: nothing here navigates, and the point of the suite is what the
 * component RENDERS, not what it does when a button is pressed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STUB_ROUTER: any = {
  push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {},
  prefetch: () => {},
}

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const SELF = 'player-self'

const MEMBERS: EditorMember[] = [
  { playerId: SELF, name: 'Site Owner', handle: 'owner_handle' },
  { playerId: 'player-a', name: 'Kevin', handle: 'sixohtwo' },
  { playerId: 'player-b', name: 'Somebody With No Handle', handle: null },
]

const BASE: EditorArticle = {
  id: 7, title: 'A title', slug: 'a-title', bodySource: 'Body.', excerpt: '',
  categoryId: null, tags: [], coverMediaId: null, coverAlt: '',
  seoTitle: '', seoDescription: '', official: false, featured: false, commentsEnabled: true,
  state: 'DRAFT', publishAt: null, reviewFeedback: null, hasPendingEdit: false,
  authorPlayerId: SELF, authorLabel: 'owner_handle',
}

/** Render the editor as a given kind of user. The dialog provider is the editor's usual context. */
function render(opts: {
  canAttributeAuthor?: boolean
  canBackdate?: boolean
  members?: EditorMember[]
  initial?: Partial<EditorArticle>
  /** Both controls live under Settings, so that is where this suite looks. */
  tab?: 'write' | 'settings'
}): string {
  return renderToStaticMarkup(
    React.createElement(
      AppRouterContext.Provider,
      { value: STUB_ROUTER },
      React.createElement(
        DialogProvider,
        null,
        React.createElement(ArticleEditor, {
          initial: { ...BASE, ...opts.initial },
          categories: [{ id: 1, name: 'Analysis', adminOnly: false }],
          canPublish: true,
          isAdmin: true,
          members: opts.members ?? [],
          canAttributeAuthor: !!opts.canAttributeAuthor,
          canBackdate: !!opts.canBackdate,
          selfPlayerId: SELF,
          initialTab: opts.tab ?? 'settings',
        }),
      ),
    ),
  )
}

// =========================================================================== not an owner

section('Somebody without the permissions')

const plain = render({})

check('the author picker is absent', !plain.includes('id="author"'))
check('the member filter is absent', !plain.includes('id="author-filter"'))
check('the publication date field is absent', !plain.includes('id="publishAt"'))
check('the Author heading is absent', !plain.includes('>Author<'))
check('the Publication date heading is absent', !plain.includes('Publication date'))

{
  // The roster is the part that actually matters: a member list is information about other people.
  const withRoster = render({ members: MEMBERS })
  check('no member name reaches the markup when the picker is off', !withRoster.includes('sixohtwo'))
  check('no member id reaches the markup either', !withRoster.includes('player-a'))
}

// =========================================================================== an owner

section('An Owner')

const owner = render({ canAttributeAuthor: true, canBackdate: true, members: MEMBERS })

check('the author picker is present', owner.includes('id="author"'))
check('the member filter is present', owner.includes('id="author-filter"'))
check('the publication date field is present', owner.includes('id="publishAt"'))
check('the date field is a datetime input', owner.includes('type="datetime-local"'))

check('every member is listed', MEMBERS.every((m) => owner.includes(m.playerId)))
check('a member is labelled by CueVerse ID', owner.includes('sixohtwo'))
check('...with the preferred name alongside it', owner.includes('Kevin'))
check('a member with no handle falls back to their name', owner.includes('Somebody With No Handle'))
check('the signed-in author is marked', owner.includes('— you'))

check('the default is the signed-in author', owner.includes('Publishing under your own name'))
check('the date defaults to publication time', owner.includes('Dated the moment you publish it'))

// =========================================================================== attributed state

section('An article attributed to somebody else')

const attributed = render({
  canAttributeAuthor: true, canBackdate: true, members: MEMBERS,
  initial: { authorPlayerId: 'player-a', authorLabel: 'sixohtwo' },
})

check('the header says whose name is on it', attributed.includes('By sixohtwo'))
check('the picker explains what readers will see', attributed.includes('Readers will see only their byline'))
check('it no longer claims to be the author\'s own', !attributed.includes('Publishing under your own name'))

{
  // The same article, viewed by somebody who cannot change the byline: no picker, and no banner
  // either, because for them the byline is simply what the article says.
  const seenByOther = render({ initial: { authorPlayerId: 'player-a', authorLabel: 'sixohtwo' } })
  check('somebody without the permission still sees who it is by', seenByOther.includes('By sixohtwo'))
  check('...but gets no picker', !seenByOther.includes('id="author"'))
}

// =========================================================================== dated state

section('An article with a date set')

{
  const past = render({
    canBackdate: true,
    initial: { publishAt: new Date('2019-03-04T17:00:00.000Z').toISOString() },
  })
  check('a past date reads as backdated', past.includes('Will read'))
  check('...showing the date the site will render', past.includes('Mar 4, 2019'))
  check('...and says it goes live on publish', past.includes('go live as soon as you publish'))
}
{
  const future = render({
    canBackdate: true,
    initial: { publishAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() },
  })
  check('a future date reads as scheduled', future.includes('Hidden until'))
  check('...and says it appears on its own', future.includes('appears on its own'))
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
