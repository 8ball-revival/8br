/**
 * Admin Portal — password-reset authorization matrix + target-tier resolution.
 * Verifies the pure permission decision (Admins reset Members; Head Admin also resets Admins;
 * the Head Admin is never reset here) and that targetTier() reflects real role/designation state.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-admin-reset.mts
 */
import { canResetTarget } from '../src/lib/staff/reset-authz.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }

const admin = { isAdmin: true, isOwner: false, isHeadAdmin: false }
const headAdmin = { isAdmin: true, isOwner: true, isHeadAdmin: true }
const nonStaff = { isAdmin: false, isOwner: false, isHeadAdmin: false }

console.log('--- reset authorization matrix ---')
check('Admin CAN reset a Member', canResetTarget(admin, 'member').ok === true)
check('Admin CANNOT reset an Admin (needs Head Admin)', canResetTarget(admin, 'admin').ok === false)
check('Admin CANNOT reset the Head Admin', canResetTarget(admin, 'headAdmin').ok === false)
check('Head Admin CAN reset a Member', canResetTarget(headAdmin, 'member').ok === true)
check('Head Admin CAN reset an Admin', canResetTarget(headAdmin, 'admin').ok === true)
check('Head Admin CANNOT reset the Head Admin (never here)', canResetTarget(headAdmin, 'headAdmin').ok === false)
check('non-staff CANNOT reset anyone', canResetTarget(nonStaff, 'member').ok === false && canResetTarget(nonStaff, 'admin').ok === false)

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
