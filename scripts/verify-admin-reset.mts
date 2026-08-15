/**
 * Admin Portal — password-reset authorization matrix + temp-code SECURITY.
 * Pure, deterministic coverage of the hardened reset primitives:
 *  - authorization matrix (who may reset whom)
 *  - keyed-HMAC code hashing (not a bare SHA-256) + constant-time verification
 *  - expiration, one-time-use intent, and attempt-limit / brute-force guards
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-admin-reset.mts
 */
import { canResetTarget, hmacCode, verifyCodeHmac, isResetExpired, attemptLimitExceeded, generateTempCode, RESET_TTL_MS, TEMP_ATTEMPT_LIMIT } from '../src/lib/staff/reset-authz.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }

const admin = { isAdmin: true, isOwner: false, isHeadAdmin: false }
const headAdmin = { isAdmin: true, isOwner: true, isHeadAdmin: true }
const nonStaff = { isAdmin: false, isOwner: false, isHeadAdmin: false }

console.log('--- authorization matrix ---')
check('Admin CAN reset a Member', canResetTarget(admin, 'member').ok === true)
check('Admin CANNOT reset an Admin (needs Head Admin)', canResetTarget(admin, 'admin').ok === false)
check('Admin CANNOT reset the Head Admin', canResetTarget(admin, 'headAdmin').ok === false)
check('Head Admin CAN reset a Member', canResetTarget(headAdmin, 'member').ok === true)
check('Head Admin CAN reset an Admin', canResetTarget(headAdmin, 'admin').ok === true)
check('Head Admin CANNOT reset the Head Admin (never here)', canResetTarget(headAdmin, 'headAdmin').ok === false)
check('non-staff CANNOT reset anyone', canResetTarget(nonStaff, 'member').ok === false && canResetTarget(nonStaff, 'admin').ok === false)

console.log('\n--- temp-code hashing (keyed HMAC, not bare SHA-256) ---')
const SECRET = 'unit-secret-key'
const code = '12345'
const h = hmacCode(code, SECRET)
check('HMAC is 64 hex chars (sha256)', /^[0-9a-f]{64}$/.test(h))
check('HMAC is keyed — different secret ⇒ different digest', hmacCode(code, 'other') !== h)
check('HMAC is deterministic for same code+secret', hmacCode(code, SECRET) === h)
// Guard against the old weakness: a bare unsalted SHA-256 of "12345" must NOT equal the stored value.
import cryptoNode from 'node:crypto'
const bareSha = cryptoNode.createHash('sha256').update(code).digest('hex')
check('stored digest is NOT a bare SHA-256 of the code', h !== bareSha)

console.log('\n--- constant-time verification ---')
check('correct code verifies', verifyCodeHmac('12345', h, SECRET) === true)
check('wrong code rejected', verifyCodeHmac('54321', h, SECRET) === false)
check('right code / wrong secret rejected', verifyCodeHmac('12345', h, 'nope') === false)
check('malformed stored hash rejected (no throw)', verifyCodeHmac('12345', 'zzzz', SECRET) === false)
check('empty stored hash rejected', verifyCodeHmac('12345', '', SECRET) === false)

console.log('\n--- expiration ---')
const now = Date.now()
check('code within TTL is not expired', isResetExpired(new Date(now + RESET_TTL_MS - 1000), now) === false)
check('code past TTL is expired', isResetExpired(new Date(now - 1000), now) === true)
check('exact-expiry boundary is expired (<=)', isResetExpired(new Date(now), now) === true)

console.log('\n--- attempt limit / brute-force guard ---')
check('below limit is allowed', attemptLimitExceeded(TEMP_ATTEMPT_LIMIT - 1) === false)
check('at limit is blocked', attemptLimitExceeded(TEMP_ATTEMPT_LIMIT) === true)
check('above limit is blocked', attemptLimitExceeded(TEMP_ATTEMPT_LIMIT + 3) === true)

console.log('\n--- code generation ---')
const codes = Array.from({ length: 200 }, () => generateTempCode())
check('all codes are exactly 5 digits', codes.every((c) => /^\d{5}$/.test(c)))
check('generator is not constant (entropy present)', new Set(codes).size > 1)

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
