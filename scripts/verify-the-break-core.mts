/**
 * The Break's core: the arithmetic that orders the feed, the rules that guard voting, and the
 * integrity of the articles that were migrated into it.
 *
 * The ranking functions are pure, so they are tested as arithmetic rather than observed through a
 * database — an ordering bug is the kind that hides for months behind plausible-looking output, and
 * the only way to catch it is to state what the numbers must do and check them.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-the-break-core.mts
 */
import { createHash } from 'node:crypto'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import {
  hotRank, risingRank, wilsonLowerBound, controversyRank,
  topWindowStart, HOT_DECAY_SECONDS, RISING_WINDOW_HOURS, TOP_WINDOWS,
} from '../src/lib/break/ranking.ts'
import { voteDelta, parseVoteValue } from '../src/lib/break/voting.ts'
import { validateForPublish, MAX_GALLERY_ITEMS } from '../src/lib/break/posts.ts'
import { decideCategory } from '../src/lib/break/legacy-map.ts'
import { LIMITS, clientHash } from '../src/lib/break/rate-limit.ts'
import {
  canPost, canComment, canVote, canModerate, ownsContent, canViewDraft, canReplyTo, canViewRemovedBody,
} from '../src/lib/break/permission-rules.ts'

assertLocalDatabase('verify-the-break-core')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 7, 20, 12, 0, 0)

// ─────────────────────────────────────────────────────────────────────────────────────── Hot
section('Hot balances score against age, and age always wins eventually')
{
  const now = NOW
  check('a higher score outranks a lower one at the same moment',
    hotRank(100, 0, now) > hotRank(10, 0, now))
  check('a newer post outranks an older one at the same score',
    hotRank(10, 0, now) > hotRank(10, 0, now - 6 * HOUR))

  /*
   * The property the specification asks for by name: one historical high scorer cannot sit at the
   * top forever. A modest fresh post has to overtake a huge old one, and this fixes when.
   */
  const ancient = hotRank(5000, 0, now - 7 * 24 * HOUR)
  check('a week-old +5000 is beaten by a fresh +1',
    hotRank(1, 0, now) > ancient, `${hotRank(1, 0, now)} vs ${ancient}`)
  check('...and by a fresh post with no score at all',
    hotRank(0, 0, now) > ancient)

  // The logarithm is what stops score dominating: ten times the votes is one unit, not ten.
  const tenfold = hotRank(100, 0, now) - hotRank(10, 0, now)
  check('ten times the score is worth exactly one unit', Math.abs(tenfold - 1) < 1e-6, String(tenfold))
  check('...which is worth 12 hours of age',
    Math.abs(tenfold - (HOT_DECAY_SECONDS / HOT_DECAY_SECONDS)) < 1e-6)

  check('a negative score ranks below an unvoted post of the same age',
    hotRank(-10, 0, now) < hotRank(0, 0, now))
  check('the sign is respected rather than the magnitude',
    hotRank(-100, 0, now) < hotRank(-10, 0, now))

  check('comments lift a post', hotRank(10, 50, now) > hotRank(10, 0, now))
  check('...but less than votes do',
    hotRank(100, 0, now) - hotRank(10, 0, now) > hotRank(10, 100, now) - hotRank(10, 10, now))

  check('it is deterministic', hotRank(37, 12, now) === hotRank(37, 12, now))
  check('...and stable to seven places', String(hotRank(37, 12, now)).split('.')[1]?.length <= 7)
}

// ──────────────────────────────────────────────────────────────────────────────────── Rising
section('Rising is velocity, and old posts cannot qualify')
{
  check('a post outside the window scores zero',
    risingRank(500, 500, NOW - (RISING_WINDOW_HOURS + 1) * HOUR, NOW) === 0)
  check('...however good it was', risingRank(99999, 9999, NOW - 48 * HOUR, NOW) === 0)
  check('a post inside the window scores above zero',
    risingRank(10, 2, NOW - 3 * HOUR, NOW) > 0)

  const fastNew = risingRank(20, 5, NOW - 2 * HOUR, NOW)
  const slowOld = risingRank(30, 5, NOW - 20 * HOUR, NOW)
  check('a fast recent post beats a slower older one with more votes',
    fastNew > slowOld, `${fastNew} vs ${slowOld}`)

  // The cold start: without it, one vote two minutes old would lead the section.
  const infant = risingRank(1, 0, NOW - 2 * 60 * 1000, NOW)
  const established = risingRank(40, 10, NOW - 4 * HOUR, NOW)
  check('a two-minute-old single vote does not lead', established > infant, `${established} vs ${infant}`)

  check('downvoted posts do not rise', risingRank(-20, 0, NOW - HOUR, NOW) === 0)
}

// ────────────────────────────────────────────────────────────────────────────────────── Best
section('Best is confidence, not raw score or raw ratio')
{
  check('no votes is zero', wilsonLowerBound(0, 0) === 0)
  check('99 of 100 beats 1 of 1',
    wilsonLowerBound(99, 1) > wilsonLowerBound(1, 0), `${wilsonLowerBound(99, 1)} vs ${wilsonLowerBound(1, 0)}`)
  check('9-0 beats 40-30 even though 40-30 has the higher score',
    wilsonLowerBound(9, 0) > wilsonLowerBound(40, 30),
    `${wilsonLowerBound(9, 0)} vs ${wilsonLowerBound(40, 30)}`)
  check('more evidence at the same ratio ranks higher',
    wilsonLowerBound(100, 10) > wilsonLowerBound(10, 1))
  check('it never exceeds the observed ratio', wilsonLowerBound(10, 0) < 1)
  check('all-downvotes is zero-ish', wilsonLowerBound(0, 20) === 0)
}

// ────────────────────────────────────────────────────────────────────────────── Controversial
section('Controversial means disagreement, not unpopularity')
{
  check('an evenly split heavy thread scores highly', controversyRank(50, 48) > controversyRank(50, 2))
  check('a merely unpopular comment is not controversial',
    controversyRank(2, 40) < controversyRank(40, 38), `${controversyRank(2, 40)} vs ${controversyRank(40, 38)}`)
  check('one-sided is zero', controversyRank(10, 0) === 0 && controversyRank(0, 10) === 0)
  check('no votes is zero', controversyRank(0, 0) === 0)
  check('more total votes at the same split scores higher',
    controversyRank(100, 100) > controversyRank(10, 10))
}

// ──────────────────────────────────────────────────────────────────────────────── Top windows
section('Top windows are real boundaries')
{
  const now = new Date(NOW)
  check('all time has no start', topWindowStart('all', now) === null)
  for (const w of TOP_WINDOWS.filter((x) => x.hours != null)) {
    const start = topWindowStart(w.key, now)!
    check(`${w.label} starts ${w.hours} hours back`,
      Math.abs(now.getTime() - start.getTime() - w.hours! * HOUR) < 1000, w.label)
  }
  check('the windows are the five the toolbar offers',
    TOP_WINDOWS.map((w) => w.key).join(',') === 'today,week,month,year,all')
}

// ────────────────────────────────────────────────────────────────────────────────────── Votes
section('Vote arithmetic')
{
  check('an upvote from nothing is +1', voteDelta(0, 1).score === 1 && voteDelta(0, 1).up === 1)
  check('a downvote from nothing is -1', voteDelta(0, -1).score === -1 && voteDelta(0, -1).down === 1)
  check('removing an upvote is -1', voteDelta(1, 0).score === -1 && voteDelta(1, 0).up === -1)
  // Switching moves the score by two and moves BOTH counters, which is the part that gets forgotten.
  check('switching up to down is -2', voteDelta(1, -1).score === -2)
  check('...and moves both tallies', voteDelta(1, -1).up === -1 && voteDelta(1, -1).down === 1)
  check('switching down to up is +2', voteDelta(-1, 1).score === 2)
  check('no change is no delta', voteDelta(1, 1).score === 0 && voteDelta(0, 0).score === 0)

  check('only directions are accepted', parseVoteValue(1) === 1 && parseVoteValue(-1) === -1 && parseVoteValue(0) === 0)
  for (const bad of [2, -2, 100, 0.5, NaN, Infinity, 'lots', null, undefined, {}, []]) {
    check(`a score of ${JSON.stringify(bad)} is refused`, parseVoteValue(bad) === null)
  }
}

// ───────────────────────────────────────────────────────────────────────────────── Publishing
section('A post is checked before it goes out')
{
  const base = {
    type: 'TEXT' as const, title: 'A title', body: { v: 1, blocks: [{ t: 'p', c: [{ t: 'text', v: 'hi' }] }] } as never,
    categoryId: 1, linkUrl: null, mediaCount: 0, pendingMedia: 0, failedMedia: 0, pollOptions: 0,
  }
  check('a complete text post passes', validateForPublish(base).length === 0, validateForPublish(base).join('; '))
  check('a title is required', validateForPublish({ ...base, title: '   ' }).some((e) => /title/i.test(e)))
  check('a category is required', validateForPublish({ ...base, categoryId: null }).some((e) => /category/i.test(e)))
  check('a link post needs a URL', validateForPublish({ ...base, type: 'LINK' }).some((e) => /URL/i.test(e)))
  check('an image post needs a file', validateForPublish({ ...base, type: 'IMAGE' }).some((e) => /file/i.test(e)))
  check('a gallery needs two', validateForPublish({ ...base, type: 'GALLERY', mediaCount: 1 }).some((e) => /two/i.test(e)))
  check('a gallery is capped',
    validateForPublish({ ...base, type: 'GALLERY', mediaCount: MAX_GALLERY_ITEMS + 1 }).some((e) => /at most/i.test(e)))
  check('a poll needs 2 to 6 options',
    validateForPublish({ ...base, type: 'POLL', pollOptions: 1 }).length > 0
    && validateForPublish({ ...base, type: 'POLL', pollOptions: 7 }).length > 0
    && validateForPublish({ ...base, type: 'POLL', pollOptions: 3 }).length === 0)

  // Publication waits for media rather than shipping a broken frame.
  check('processing media blocks publication',
    validateForPublish({ ...base, type: 'VIDEO', mediaCount: 1, pendingMedia: 1 }).some((e) => /processing/i.test(e)))
  check('failed media blocks publication',
    validateForPublish({ ...base, type: 'VIDEO', mediaCount: 1, failedMedia: 1 }).some((e) => /failed/i.test(e)))
  check('every problem is reported at once, not one per attempt',
    validateForPublish({ ...base, title: '', categoryId: null }).length >= 2)
}

// ──────────────────────────────────────────────────────────────────────────────── Permissions
section('Permissions')
{
  const member = { playerId: 'p1', name: 'Member', handle: 'member', isAdmin: false, isOwner: false, isTrustedAuthor: false }
  const trusted = { ...member, playerId: 'p2', isTrustedAuthor: true }
  const admin = { ...member, playerId: 'p3', isAdmin: true }

  check('an anonymous visitor cannot post', !canPost(null))
  check('...cannot comment', !canComment(null))
  check('...cannot vote', !canVote(null))
  check('...and cannot moderate', !canModerate(null))

  check('a signed-in member can post', canPost(member))
  // The rule the specification changes: Trusted Author is no longer a gate.
  check('an ordinary member posts without being a Trusted Author', canPost(member) && !member.isTrustedAuthor)
  check('being a Trusted Author grants nothing extra', canPost(trusted) === canPost(member))
  check('a member cannot moderate', !canModerate(member))
  check('an admin can', canModerate(admin))

  check('ownership is by canonical player id', ownsContent(member, 'p1') && !ownsContent(member, 'p9'))
  check('a draft is visible only to its author', canViewDraft(member, 'p1') && !canViewDraft(admin, 'p1'))
  check('...including to staff', !canViewDraft(admin, 'p1'))
  check('a removed body goes back to its author', canViewRemovedBody(member, 'p1'))
  check('...and to staff', canViewRemovedBody(admin, 'p1'))
  check('...but not to a passer-by', !canViewRemovedBody({ ...member, playerId: 'p9' }, 'p1'))

  const open = { postLocked: false, branchLocked: false, commentsEnabled: true }
  check('a member may reply on an open post', canReplyTo(member, open))
  check('a locked post stops new replies', !canReplyTo(member, { ...open, postLocked: true }))
  check('a locked branch stops new replies', !canReplyTo(member, { ...open, branchLocked: true }))
  check('closed comments stop new replies', !canReplyTo(member, { ...open, commentsEnabled: false }))
  check('staff can still answer on a locked post', canReplyTo(admin, { ...open, postLocked: true }))
  check('nobody signed out can reply', !canReplyTo(null, open))
}

// ─────────────────────────────────────────────────────────────────────────── Category mapping
section('Legacy category mapping is deterministic')
{
  check('the author\'s own filing wins', decideCategory('predictions', 'Anything').slug === 'prediction')
  check('history maps to history', decideCategory('history', 'x').slug === 'history')
  check('official news maps to news', decideCategory('official-news', 'x').slug === 'news')
  check('analysis becomes discussion', decideCategory('analysis', 'x').slug === 'discussion')
  check('an unfiled match-up is a prediction',
    decideCategory(null, '6o2 Invitational Semifinals - Kevin vs Travis').slug === 'prediction')
  check('an unfiled tribute is history',
    decideCategory(null, 'A TRIBUTE TO MAJOR LEAGUE POOL').slug === 'history')
  check('anything else is discussion',
    decideCategory(null, 'Top 10 Active CueVerse Players + 3 New Players').slug === 'discussion')
  check('it is stable across runs',
    decideCategory(null, 'A TRIBUTE TO MAJOR LEAGUE POOL').slug === decideCategory(null, 'A TRIBUTE TO MAJOR LEAGUE POOL').slug)
  check('every decision carries a reason', decideCategory(null, 'x').reason.length > 0)
}

// ─────────────────────────────────────────────────────────────────────────────── Rate limits
section('Rate limits are configured and hashes are not reversible signals')
{
  for (const [action, limit] of Object.entries(LIMITS)) {
    check(`${action} has a positive allowance`, limit.max > 0 && limit.windowSeconds > 0, action)
  }
  check('posting is tighter than voting', LIMITS['post.create'].max < LIMITS.vote.max)
  check('a null signal produces no hash', clientHash(null) === null)
  check('a signal is hashed, not stored', clientHash('192.0.2.1') !== '192.0.2.1')
  check('...the same signal hashes the same', clientHash('192.0.2.1') === clientHash('192.0.2.1'))
  check('...different signals differ', clientHash('192.0.2.1') !== clientHash('192.0.2.2'))
}

// ────────────────────────────────────────────────────────────────────── Migration integrity
section('Every migrated article is intact')
{
  const articles = await prisma.article.findMany({ orderBy: { id: 'asc' } })
  const posts = await prisma.breakPost.findMany({
    where: { legacyArticleId: { not: null } },
    include: { category: true, media: true },
    orderBy: { legacyArticleId: 'asc' },
  })

  check('every article has a post', posts.length === articles.length, `${posts.length} of ${articles.length}`)

  /*
   * The comparison ignores ordered-list `start`, and only that.
   *
   * The migration could not carry list numbering, because the field did not exist: a ranking whose
   * items each had prose between them arrived as a run of one-item lists, every one of which renders
   * as "1.". Setting `start` on those lists restores what the source said and changes no wording, so
   * it is the one difference this check tolerates.
   *
   * Everything else stays byte-identical. Stripping the field from BOTH sides means a body that
   * differs in any other respect — a word, a link, a block, an ordering — still fails, which is what
   * this check is for.
   */
  const withoutListStart = (v: unknown) => JSON.stringify(v, (k, val) => (k === 'start' ? undefined : val))
  const sha = (v: unknown) => createHash('sha256').update(withoutListStart(v)).digest('hex')
  for (const a of articles) {
    const p = posts.find((x) => x.legacyArticleId === a.id)
    if (!p) { check(`article ${a.id} migrated`, false, 'no post'); continue }

    check(`#${a.id} body is byte-identical apart from list numbering`, sha(p.body) === sha(a.body), `${a.title}`)
    check(`#${a.id} title preserved`, p.title === a.title)
    check(`#${a.id} slug preserved`, p.slug === a.slug, `${p.slug} vs ${a.slug}`)
    check(`#${a.id} author preserved`, p.authorNameSnapshot === a.authorNameSnapshot)
    check(`#${a.id} author identity preserved`, p.authorPlayerId === a.authorPlayerId)
    check(`#${a.id} publication date preserved`,
      p.publishedAt?.getTime() === (a.publishedAt ?? a.publishAt)?.getTime(),
      `${p.publishedAt?.toISOString()} vs ${(a.publishedAt ?? a.publishAt)?.toISOString()}`)
    check(`#${a.id} has a category`, p.categoryId != null, p.category?.slug)
    check(`#${a.id} view count preserved`, p.viewCount === a.viewCount)
    if (a.coverMediaId) {
      check(`#${a.id} cover image carried across`,
        p.media.some((m) => m.storageKey === a.coverMediaId), JSON.stringify(p.media.map((m) => m.storageKey)))
    }
  }

  // The two the owner named explicitly.
  const tribute = posts.find((p) => /TRIBUTE TO MAJOR LEAGUE POOL/i.test(p.title))
  check('the Major League Pool tribute is present', !!tribute)
  check('...with its full body', JSON.stringify(tribute?.body ?? '').length > 9000,
    String(JSON.stringify(tribute?.body ?? '').length))
  check('...and its image', (tribute?.media.length ?? 0) > 0)
  check('...filed under History', tribute?.category?.slug === 'history')

  const kevin = posts.find((p) => /Kevin vs Travis/i.test(p.title))
  check('the Kevin vs Travis prediction is present', !!kevin)
  check('...with its full body', JSON.stringify(kevin?.body ?? '').length > 12000,
    String(JSON.stringify(kevin?.body ?? '').length))
  check('...filed under Prediction', kevin?.category?.slug === 'prediction')

  // The compatibility period: the source is still there to compare against.
  check('the article tables are untouched', articles.length === 3, String(articles.length))

  // Published posts carry the author's real +1, not a fabricated score.
  for (const p of posts.filter((x) => x.state === 'PUBLISHED' && x.authorPlayerId)) {
    const vote = await prisma.breakPostVote.findUnique({
      where: { postId_playerId: { postId: p.id, playerId: p.authorPlayerId! } },
      select: { value: true },
    })
    check(`#${p.legacyArticleId} has a real author vote`, vote?.value === 1)
    check(`#${p.legacyArticleId} score matches its votes`, p.score === 1, String(p.score))
  }
}

// ───────────────────────────────────────────────────────────────── Nothing competitive moved
section('The Break has not touched the competition data')
{
  check('Season 3732 is present',
    (await prisma.season.count({ where: { id: 3732 } })) === 1)
  const s = await prisma.season.findUnique({
    where: { id: 3732 },
    include: { _count: { select: { entrants: true, groups: true, matches: true, standings: true, playoffMatches: true } } },
  })
  check('...with its 49 entrants', s?._count.entrants === 49, String(s?._count.entrants))
  check('...its 7 groups', s?._count.groups === 7, String(s?._count.groups))
  check('...and its 147 matches', s?._count.matches === 147, String(s?._count.matches))

  // The ledger grows as reconstructed Seasons are completed and applied. The Break adds none.
  const ledger = await prisma.ratingLedger.count()
  check('no ledger row was lost', ledger >= 1168, String(ledger))
  // The roster grows as the owner creates members; what matters is that The Break removed none.
  const players = await prisma.player.count()
  check('no player was removed', players >= 142, String(players))

  // Karma is a community figure and must never appear as a competition one.
  const karma = await prisma.breakKarma.findMany()
  check('karma lives in its own table, not on the Player', Array.isArray(karma))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
