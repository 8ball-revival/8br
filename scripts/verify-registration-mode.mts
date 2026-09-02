/**
 * The "Create an Account" setting.
 *
 * The comparison rules are executed directly against the module the server action uses, and the
 * persistence and gate are exercised against the development database. What this does NOT do is
 * create real accounts: the signup path writes Payload users and Player profiles, and a test suite
 * that manufactured members would leave real rows behind. The account-shape guarantee is asserted from
 * the one place that decides it instead — see the roles check at the end.
 */

import { prisma } from '@/lib/prisma'
import {
  codesMatch, isUsableCode, normalizeCode, parseRegistrationMode,
  REGISTRATION_SETTING_LABEL, REGISTRATION_MODES,
  CODE_REJECTED_MESSAGE, CODE_REQUIRED_MESSAGE,
} from '@/lib/account/registration-code'
import {
  getRegistrationMode, getRegistrationConfig, updateRegistrationSettings,
  REGISTRATION_MODE_KEY, REGISTRATION_CODE_KEY,
} from '@/lib/account/registration-settings'
import { readFileSync } from 'node:fs'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1 } else { failed += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

// The suite changes a real setting, so remember what it was and put it back at the end.
const original = await getRegistrationConfig()

// ─────────────────────────────────────────────────── the label
console.log('\nthe setting')
{
  check('the setting is labelled exactly "Create an Account"',
    REGISTRATION_SETTING_LABEL === 'Create an Account', REGISTRATION_SETTING_LABEL)
  check('it offers exactly two modes', REGISTRATION_MODES.length === 2)
  check('...Public and Private',
    REGISTRATION_MODES.includes('PUBLIC') && REGISTRATION_MODES.includes('PRIVATE'))
}

// ─────────────────────────────────────────────────── mode parsing
console.log('\nmode parsing')
{
  check('Private is recognised', parseRegistrationMode('PRIVATE') === 'PRIVATE')
  check('Public is recognised', parseRegistrationMode('PUBLIC') === 'PUBLIC')
  check('case does not matter', parseRegistrationMode('private') === 'PRIVATE')
  check('surrounding space does not matter', parseRegistrationMode('  PRIVATE  ') === 'PRIVATE')
  // A corrupt value must not lock the site into a state nobody can sign up in.
  check('an unknown value falls back to Public', parseRegistrationMode('nonsense') === 'PUBLIC')
  check('a missing value falls back to Public', parseRegistrationMode(undefined) === 'PUBLIC')
  check('null falls back to Public', parseRegistrationMode(null) === 'PUBLIC')
}

// ─────────────────────────────────────────────────── whitespace and case
console.log('\ncode comparison')
{
  check('the exact code matches', codesMatch('luna', 'luna'))
  check('leading space is ignored', codesMatch('  luna', 'luna'))
  check('trailing space is ignored', codesMatch('luna  ', 'luna'))
  check('space on both sides is ignored', codesMatch('  luna  ', 'luna'))
  check('a tab is ignored', codesMatch('\tluna\t', 'luna'))
  check('a newline from a paste is ignored', codesMatch('luna\n', 'luna'))
  check('upper case matches', codesMatch('LUNA', 'luna'))
  check('mixed case matches', codesMatch('LuNa', 'luna'))
  check('a configured code in capitals still matches lower case', codesMatch('luna', 'LUNA'))
  check('an internal run of spaces collapses', codesMatch('two  words', 'two words'))

  check('a different code is rejected', !codesMatch('moon', 'luna'))
  check('a prefix is rejected', !codesMatch('lun', 'luna'))
  check('a code with an extra character is rejected', !codesMatch('lunax', 'luna'))
  check('an empty submission is rejected', !codesMatch('', 'luna'))
  check('whitespace only is rejected', !codesMatch('   ', 'luna'))
  check('null is rejected', !codesMatch(null, 'luna'))

  // Fail closed: an empty configured code must never act as "anything goes".
  check('a blank configured code matches nothing', !codesMatch('', ''))
  check('...not even a blank submission', !codesMatch('   ', '   '))
  check('...and not an arbitrary string', !codesMatch('anything', ''))

  check('normalisation folds case and space', normalizeCode('  LuNa  ') === 'luna')
  check('a usable code is recognised', isUsableCode('luna'))
  check('blank is not a usable code', !isUsableCode('   '))
}

// ─────────────────────────────────────────────────── messages give nothing away
console.log('\nmessages')
{
  for (const [label, msg] of [['rejected', CODE_REJECTED_MESSAGE], ['required', CODE_REQUIRED_MESSAGE]] as const) {
    check(`the ${label} message does not contain the configured code`,
      !msg.toLowerCase().includes('luna'), msg)
    check(`the ${label} message is friendly and actionable`, msg.length > 20 && /try again|enter the code/i.test(msg))
  }
  // Neither message may hint at the value, the length, or how close a guess was.
  for (const msg of [CODE_REJECTED_MESSAGE, CODE_REQUIRED_MESSAGE]) {
    check('the message reveals nothing about the code itself',
      !/\d+\s*(characters|letters|digits)/i.test(msg) && !/starts with|begins with|close/i.test(msg), msg)
  }
}

// ─────────────────────────────────────────────────── persistence
console.log('\npersistence')
{
  const save = await updateRegistrationSettings({ mode: 'PRIVATE', code: 'luna' })
  check('Private with a code saves', save.ok, save.error ?? '')
  check('the mode round-trips', (await getRegistrationMode()) === 'PRIVATE')
  const cfg = await getRegistrationConfig()
  check('the code round-trips for an administrator', cfg.code === 'luna')

  // Private with no code would render a required field nothing could satisfy.
  const blank = await updateRegistrationSettings({ mode: 'PRIVATE', code: '   ' })
  check('Private with a blank code is refused', !blank.ok)
  check('...with an explanation naming the problem', /code/i.test(blank.error ?? ''))
  check('...and the previous setting is untouched', (await getRegistrationMode()) === 'PRIVATE')

  const pub = await updateRegistrationSettings({ mode: 'PUBLIC', code: '' })
  check('Public saves without a code', pub.ok)
  check('the mode round-trips back to Public', (await getRegistrationMode()) === 'PUBLIC')
  check('the code is kept when switching to Public, so toggling back needs no retyping',
    (await getRegistrationConfig()).code === 'luna')

  const tooLong = await updateRegistrationSettings({ mode: 'PRIVATE', code: 'x'.repeat(500) })
  check('an absurdly long code is refused', !tooLong.ok)
}

// ─────────────────────────────────────────────────── the code is not a public value
console.log('\nthe code is not exposed')
{
  const { SETTINGS_FIELDS } = await import('@/lib/staff/site-settings-shared')
  const keys = SETTINGS_FIELDS.map((f: { key: string }) => f.key)
  check('the registration code is not a generic site-settings field, so the shared reader cannot return it',
    !keys.includes(REGISTRATION_CODE_KEY as never), keys.join(','))
  check('...and neither is the mode, which the registration page reads through its own function',
    !keys.includes(REGISTRATION_MODE_KEY as never))

  // The public page must pass only the mode into the component tree.
  const pageSrc = readFileSync('src/app/(frontend)/register/page.tsx', 'utf8')
  check('the registration page never reads the code',
    !pageSrc.includes('getRegistrationConfig') && !pageSrc.includes(REGISTRATION_CODE_KEY))
  check('...it reads only the mode', pageSrc.includes('getRegistrationMode'))

  const formSrc = readFileSync('src/components/account/create-account-form.tsx', 'utf8')
  // The form renders an input NAMED registrationCode - that is the field the member types into, and is
  // expected. What must never happen is the configured VALUE arriving as a prop or a default.
  check('the public form takes only a boolean, not the code',
    /requireCode\?: boolean/.test(formSrc))
  check('...and never receives a code value as a prop or default',
    !/registrationCode\s*[?:]\s*string/.test(formSrc)
      && !/defaultValue=\{[^}]*code/i.test(formSrc))
  check('...so the rendered field starts empty',
    !/name="registrationCode"[\s\S]{0,200}(value|defaultValue)=/.test(formSrc))

  /*
    A rejected code must not empty the rest of the form.

    `useActionState` re-renders the form when the action returns, and React resets an UNCONTROLLED
    input at that point — so one wrong invite code wiped the ID, the email and the password too, and
    all of them had to be typed again to correct one field. Holding the values in client state fixes
    it without the password ever travelling back down from the server to be restored.
  */
  check('what was typed survives a rejected submit',
    /useState\(\{[\s\S]{0,200}registrationCode: '',[\s\S]{0,200}password: '',/.test(formSrc))
  check('...on every field', ['registrationCode', 'cueverseId', 'preferredName', 'email', 'password']
    .every((f) => formSrc.includes(`{...field('${f}')}`)))
  check('...and the values are held on the client, not echoed by the server',
    !/state\.(values|submitted|fields)/.test(formSrc))
}

// ─────────────────────────────────────────────────── permissions
console.log('\npermissions')
{
  const actionsSrc = readFileSync('src/lib/account/registration-actions.ts', 'utf8')
  check('reading the setting is permission-checked', /readRegistrationSettings[\s\S]{0,220}requireAdmin/.test(actionsSrc))
  check('saving the setting is permission-checked', /saveRegistrationSettings[\s\S]{0,320}requireAdmin/.test(actionsSrc))
  check('the check is enforced inside the action, not only on the page',
    actionsSrc.includes('resolveStaffAccess'))
  check('a non-administrator is refused without being told the code',
    !actionsSrc.includes('luna'))
}

// ─────────────────────────────────────────────────── the account created is ordinary
console.log('\nthe resulting account is an ordinary member')
{
  const src = readFileSync('src/lib/account/actions.ts', 'utf8')

  // The gate must run BEFORE any account work, and must not touch what the account becomes.
  const gateAt = src.indexOf('getRegistrationMode')
  const createAt = src.indexOf("collection: 'users', data: { username, email, password, roles:")
  check('the code is checked before the account is created', gateAt !== -1 && gateAt < createAt)
  check('accounts are created with the member role only',
    /roles: \['member'\]/.test(src))
  check('passing a code grants no elevated role',
    !/registrationCode[\s\S]{0,400}roles:\s*\[[^\]]*(admin|owner|moderator|staff)/i.test(src))
  check('the code check is server-side, in the server action', src.startsWith("'use server'"))
  check('a missing code in Private mode is refused', src.includes('CODE_REQUIRED_MESSAGE'))
  check('a wrong code is refused', src.includes('CODE_REJECTED_MESSAGE'))
  check('repeated wrong codes are rate limited', src.includes('CODE_RATE_LIMITED_MESSAGE'))

  // Public mode must not ask for anything.
  const publicGate = /registrationMode === 'PRIVATE'/.test(src)
  check('the code is only required in Private mode', publicGate)
}

// ─────────────────────────────────────────────────── restore
await updateRegistrationSettings(original.mode === 'PRIVATE' && original.code
  ? { mode: 'PRIVATE', code: original.code }
  : { mode: original.mode, code: original.code })
const restored = await getRegistrationConfig()
check('the suite restored the original setting',
  restored.mode === original.mode && restored.code === original.code,
  `${restored.mode} vs ${original.mode}`)

await prisma.$disconnect()

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
