/**
 * Member Management: the permanent new-member form, and the order the list is in.
 *
 * ── Two claims worth testing ─────────────────────────────────────────────────────────────────────
 * The first is that the form cannot go away. It used to live behind a button, and a form with a
 * hidden state has a way to end up hidden — after a successful save, after a Cancel, after anything
 * that resets component state. Proving the button is gone is not enough; what matters is that no
 * code path remains that could collapse it.
 *
 * The second is that the list has a defined order at all times. An unordered list looks fine until
 * two loads of unchanged data disagree, which is exactly the failure a locale-dependent comparison
 * produces between a developer's machine and the deployed one. The comparator is exercised directly
 * against real member rows rather than asserted about.
 *
 * Nothing here creates an account: the creation path itself is covered by verify-member-duplicates
 * and the canonical service's own suite. This checks presentation and ordering.
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import {
  compareMembersByName, compareMembersByColumn, foldForSort,
} from '../src/lib/staff/member-order.ts'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)
const read = (p: string) => readFileSync(p, 'utf8')

try {
  const form = read('src/components/staff/create-member-form.tsx')
  const page = read('src/app/(frontend)/staff/members/page.tsx')

  section('The form is permanent')
  check('the "Create New Member" button is gone', !form.includes('Create New Member'))
  check('...and so is the file that was named after it', (() => {
    try { read('src/components/staff/create-member-button.tsx'); return false } catch { return true }
  })())
  check('the page renders the form directly', page.includes('<CreateMemberForm />'))
  check('nothing gates the markup behind open state', !/\{open &&/.test(form))
  check('...because there is no open state left', !/\bsetOpen\b/.test(form) && !/useState\(false\)[\s\S]{0,40}open/.test(form))
  check('the heading the form is known by is still there', form.includes('New member account'))
  check('the duplicates panel is still beside it, not under it',
    /lg:grid-cols-\[minmax\(0,1fr\)_20rem\]/.test(form) && form.includes('<DuplicatePanel'))

  section('Clear empties the form; it cannot hide it')
  check('the control is labelled Clear', />\s*Clear\s*</.test(form))
  check('...and neither Cancel nor Done survives', !/>\s*(Cancel|Done)\s*</.test(form))
  check('it resets the fields', /function clearForm\(\)[\s\S]{0,200}clearFields\(\)/.test(form))
  check('...and returns focus for the next entry', /function clearForm\(\)[\s\S]{0,200}cueRef\.current\?\.focus\(\)/.test(form))
  check('it is disabled when there is nothing to clear', /disabled=\{pending \|\| \(!cueverseId && !preferredName\)\}/.test(form))

  section('Creation still goes through the canonical service')
  check('the form calls the existing action', form.includes('createMemberAction({ cueverseId: id, preferredName })'))
  // One call site. The import is the second mention and is not a path.
  check('...and no second creation path was added',
    (form.match(/createMemberAction\(/g) ?? []).length === 1 && !/prisma\./.test(form))
  const action = read('src/lib/staff/create-member.ts')
  check('...which delegates to the one member service', /createMember\(/.test(action))
  check('duplicate detection is untouched', form.includes('findPossibleDuplicatesAction'))
  check('...and still runs as you type, before the account exists',
    /useEffect\(\(\) => \{[\s\S]*?findPossibleDuplicatesAction/.test(form))
  check('the temporary password is still the shared constant', form.includes('{TEMPORARY_PASSWORD}'))

  section('Enter submits, and a save leaves the form ready for the next person')
  check('the fields are inside a real form element', /<form\s*\n\s*onSubmit=/.test(form))
  check('...which submits rather than reloading the page', /e\.preventDefault\(\)[\s\S]{0,40}void submit\(\)/.test(form))
  check('the submit button is type=submit', /type="submit"/.test(form))
  check('a successful save clears the fields', /setAdded\(\(prev\) => \[\.\.\.prev, id\]\)[\s\S]{0,80}clearFields\(\)/.test(form))
  check('...refreshes the list and the count', /router\.refresh\(\)/.test(form))
  check('...and puts the cursor back in the CueVerse ID field', /router\.refresh\(\)[\s\S]{0,120}cueRef\.current\?\.focus\(\)/.test(form))
  check('the running tally of the sitting is kept', form.includes('Added this sitting'))

  section('The default order is explicit and locale-independent')
  const order = read('src/lib/staff/member-order.ts')
  // The name appears in the note explaining why it is not used; what matters is that it is not called.
  check('no locale-dependent comparison is used', !/\.localeCompare\(/.test(order))
  check('...case is folded explicitly instead', order.includes('toLowerCase()'))
  check('the page sorts even without a header choice', page.includes('[...filtered].sort(compareMembersByName)'))
  check('...and uses the same module for an explicit column', page.includes('compareMembersByColumn(a, b, sortKey, sortDir)'))
  check('the old inline comparator is gone', !/localeCompare/.test(page))

  section('The rule, against real member rows')
  /*
   * Preferred Name is `Player.primaryName`.
   *
   * The member list renames it on the way out (see listMembers), and selecting the display name
   * instead of the stored one throws — which this suite did, silently, because the counter had
   * already been printed by the time the exception unwound.
   */
  const rows = (await prisma.player.findMany({
    where: { linkedUserId: { not: null } },
    select: { cueverseId: true, primaryName: true },
    take: 500,
  })).map((r) => ({ cueverseId: r.cueverseId, preferredName: r.primaryName }))
  check(`there are members to order (${rows.length})`, rows.length > 0)
  const sorted = [...rows].sort(compareMembersByName)

  const firstBlank = sorted.findIndex((m) => !foldForSort(m.preferredName))
  const lastNamed = sorted.map((m) => !!foldForSort(m.preferredName)).lastIndexOf(true)
  check('every member without a Preferred Name comes after every member with one',
    firstBlank === -1 || firstBlank > lastNamed, `firstBlank=${firstBlank} lastNamed=${lastNamed}`)

  const named = sorted.filter((m) => foldForSort(m.preferredName))
  let ascending = true
  let offender = ''
  for (let i = 1; i < named.length; i++) {
    const a = foldForSort(named[i - 1].preferredName)
    const b = foldForSort(named[i].preferredName)
    if (a > b) { ascending = false; offender = `${a} before ${b}`; break }
  }
  check('named members run A–Z, case-insensitively', ascending, offender)

  check('the comparison ignores case', compareMembersByName(
    { preferredName: 'alice', cueverseId: 'a' }, { preferredName: 'ALICE', cueverseId: 'a' }) === 0)
  check('...and a lowercase name still precedes a later uppercase one', compareMembersByName(
    { preferredName: 'alice', cueverseId: 'x' }, { preferredName: 'BOB', cueverseId: 'y' }) < 0)
  check('equal Preferred Names fall back to CueVerse ID A–Z', compareMembersByName(
    { preferredName: 'Sam', cueverseId: 'aaa' }, { preferredName: 'sam', cueverseId: 'bbb' }) < 0)
  check('...deterministically, in both argument orders', compareMembersByName(
    { preferredName: 'Sam', cueverseId: 'bbb' }, { preferredName: 'sam', cueverseId: 'aaa' }) > 0)
  check('a blank name loses to any name', compareMembersByName(
    { preferredName: '', cueverseId: 'aaa' }, { preferredName: 'zoe', cueverseId: 'zzz' }) > 0)
  check('...and whitespace counts as blank', compareMembersByName(
    { preferredName: '   ', cueverseId: 'aaa' }, { preferredName: 'zoe', cueverseId: 'zzz' }) > 0)
  check('two blanks are ordered by CueVerse ID', compareMembersByName(
    { preferredName: null, cueverseId: 'aaa' }, { preferredName: null, cueverseId: 'bbb' }) < 0)

  section('An explicit header sort still overrides, and stays total')
  const desc = [...rows].sort((a, b) => compareMembersByColumn(a, b, 'preferredName', 'desc'))
  const descNamed = desc.filter((m) => foldForSort(m.preferredName))
  let descending = true
  for (let i = 1; i < descNamed.length; i++) {
    if (foldForSort(descNamed[i - 1].preferredName) < foldForSort(descNamed[i].preferredName)) { descending = false; break }
  }
  check('descending really reverses the names', descending)
  check('...while blanks still sort last', (() => {
    const fb = desc.findIndex((m) => !foldForSort(m.preferredName))
    const ln = desc.map((m) => !!foldForSort(m.preferredName)).lastIndexOf(true)
    return fb === -1 || fb > ln
  })())
  check('reversing does not shuffle rows the column calls equal', compareMembersByColumn(
    { preferredName: 'Sam', cueverseId: 'aaa' }, { preferredName: 'sam', cueverseId: 'bbb' }, 'preferredName', 'desc') < 0)
  check('sorting by CueVerse ID orders by it', compareMembersByColumn(
    { preferredName: 'Zoe', cueverseId: 'aaa' }, { preferredName: 'Amy', cueverseId: 'bbb' }, 'cueverseId', 'asc') < 0)

  section('Search and filters keep the order')
  /*
   * The ordering is applied to `filtered`, which is what search and every filter produce. A sort
   * applied to `all` instead would look right on an unfiltered page and silently lose its order the
   * moment somebody typed in the search box.
   */
  check('the sort is applied to the filtered set, not the raw one', /\[\.\.\.filtered\]\.sort/.test(page))
  check('...and both branches sort it', (page.match(/\[\.\.\.filtered\]\.sort/g) ?? []).length === 2)
  check('a chosen sort survives a filter submit', page.includes('<input type="hidden" name="sort"'))
  check('...along with its direction', page.includes('<input type="hidden" name="dir"'))
  check('no sort in the URL means the default, not "unsorted"',
    /const sortKey: SortKey \| null = sort === 'cueverseId' \|\| sort === 'preferredName' \? sort : null/.test(page))
} catch (e) {
  /*
   * A throw is a failed suite, not a short one.
   *
   * Without this, an exception halfway through skipped every remaining check and still printed a
   * clean-looking RESULT line — the counter only knows about checks that ran.
   */
  fail++
  console.log('  ✗ the suite threw before finishing — ' + (e as Error).message.split('\n')[0])
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
