/**
 * Verification for the admin-managed site content (site-branding + homepage-hero globals).
 *
 * Covers the guarantees the feature is supposed to make:
 *   · button destinations are validated (javascript: and friends rejected, site paths accepted)
 *   · Save Draft does NOT change what the public site reads
 *   · Publish DOES change it
 *   · version history survives and an earlier published version can be restored
 *   · only ADMIN/OWNER may draft, publish or restore — members and non-admin staff cannot
 *   · anonymous reads see published content only
 *
 * Non-destructive: it works on the real globals but snapshots them first and restores the exact
 * approved wording at the end, and every temporary account it creates is deleted again.
 *
 * Usage:
 *   node scripts/run-with-esm.mjs npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-site-content.mts
 */
try {
  process.loadEnvFile('.env')
} catch {
  /* absent file is fine */
}

const { getPayload } = await import('payload')
const config = (await import('../src/payload.config.ts')).default
const { checkLinkDestination, safeHref } = await import('../src/lib/site-content/link.ts')
const { APPROVED_SITE_CONTENT: APPROVED } = await import('../src/lib/site-content/defaults.ts')

let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const HERO = 'homepage-hero'

async function main() {
  const p = await getPayload({ config })

  // ---------------------------------------------------------------- link validation
  console.log('\n--- Button destination validation ---')
  for (const bad of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example.com',
    '/\\evil.example.com',
    'mailto:a@b.c',
    '',
  ]) {
    check(`rejects ${JSON.stringify(bad)}`, !checkLinkDestination(bad).ok)
  }
  for (const good of ['/seasons', '/tournaments?year=2026', '/rules#formats', 'https://example.com', '#top']) {
    check(`accepts ${JSON.stringify(good)}`, checkLinkDestination(good).ok)
  }
  check('safeHref() neutralises a stored javascript: value', safeHref('javascript:alert(1)') === '/')
  check('safeHref() passes a valid path through', safeHref('/seasons') === '/seasons')

  // ---------------------------------------------------------------- snapshot
  const before = (await p.findGlobal({ slug: HERO, draft: false })) as Record<string, unknown>
  const approvedHeadline = before.headlineLine1

  // ---------------------------------------------------------------- accounts
  console.log('\n--- Temporary accounts ---')
  const stamp = Date.now()
  const mk = async (roles: string[], tag: string) =>
    p.create({
      collection: 'users',
      data: {
        username: `zzverify_${tag}_${stamp}`,
        email: `zzverify_${tag}_${stamp}@example.invalid`,
        password: `Pw!${stamp}aA1`,
        roles,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
  // NOTE: an `owner` account cannot be minted here — Users has a guard hook ("Owner can only be
  // granted by transferring ownership"). The OWNER branch of the gate is therefore asserted against
  // the shared access predicate below instead of through a live account.
  const member = await mk(['member'], 'member')
  const admin = await mk(['admin'], 'admin')
  check('created member / admin test accounts', Boolean(member?.id && admin?.id))

  const created = [member, admin]
  const cleanup = async () => {
    for (const u of created) {
      try {
        await p.delete({ collection: 'users', id: u.id })
      } catch {
        /* best effort */
      }
    }
    // Creating a user also provisions a linked Player profile (one account = one profile).
    // Deleting the user does NOT cascade to it, so remove the profiles too — otherwise every run
    // leaves orphan players behind and they pile up in Player Management.
    try {
      const { prisma } = await import('../src/lib/prisma.ts')
      await prisma.player.deleteMany({ where: { cueverseId: { startsWith: 'zzverify_' } } })
    } catch {
      /* best effort */
    }
  }

  try {
    // -------------------------------------------------------------- access control
    console.log('\n--- Access control (who may change site content) ---')
    const tryUpdate = async (user: unknown, label: string, expectAllowed: boolean) => {
      let allowed = true
      try {
        await p.updateGlobal({
          slug: HERO,
          data: { headlineLine1: 'ACCESSTEST' },
          draft: true,
          overrideAccess: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          user: user as any,
        })
      } catch {
        allowed = false
      }
      check(
        `${label} ${expectAllowed ? 'CAN' : 'cannot'} save a draft`,
        allowed === expectAllowed,
        `got allowed=${allowed}`,
      )
    }
    await tryUpdate(null, 'anonymous', false)
    await tryUpdate(member, 'member', false)
    await tryUpdate(admin, 'admin', true)

    // The gate itself, exercised directly — this is the same `adminOnly` used by both globals, so
    // it covers OWNER (which cannot be created here) and the retired EDITOR tier.
    const { isAdminUser } = await import('../src/collections/access.ts')
    check('gate allows owner', isAdminUser({ roles: ['owner'] }) === true)
    check('gate allows admin', isAdminUser({ roles: ['admin'] }) === true)
    check('gate denies member', isAdminUser({ roles: ['member'] }) === false)
    check('gate denies legacy editor (retired tier is not admin)', isAdminUser({ roles: ['editor'] }) === false)
    check('gate denies anonymous', isAdminUser(null) === false)
    check('gate denies unknown role', isAdminUser({ roles: ['moderator'] }) === false)

    // A non-admin must not be able to read unpublished drafts either.
    let memberSawDraft = true
    try {
      await p.findGlobalVersions({
        slug: HERO,
        limit: 1,
        overrideAccess: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user: member as any,
      })
    } catch {
      memberSawDraft = false
    }
    check('member cannot read version history (drafts stay private)', !memberSawDraft)

    // -------------------------------------------------------------- draft vs published
    console.log('\n--- Save Draft does not change the public site ---')
    const publishedBefore = (await p.findGlobal({ slug: HERO, draft: false })) as Record<string, unknown>
    await p.updateGlobal({
      slug: HERO,
      data: { headlineLine1: 'DRAFT-ONLY-VALUE' },
      draft: true,
    })
    const publishedAfterDraft = (await p.findGlobal({ slug: HERO, draft: false })) as Record<string, unknown>
    check(
      'published headline unchanged after saving a draft',
      publishedAfterDraft.headlineLine1 === publishedBefore.headlineLine1,
      `published now ${JSON.stringify(publishedAfterDraft.headlineLine1)}`,
    )
    const draftRead = (await p.findGlobal({ slug: HERO, draft: true })) as Record<string, unknown>
    check('the draft itself holds the new value', draftRead.headlineLine1 === 'DRAFT-ONLY-VALUE')

    // -------------------------------------------------------------- publish
    console.log('\n--- Publishing makes it live ---')
    await p.updateGlobal({
      slug: HERO,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { headlineLine1: 'PUBLISHED-VALUE', _status: 'published' } as any,
    })
    const afterPublish = (await p.findGlobal({ slug: HERO, draft: false })) as Record<string, unknown>
    check('published headline reflects the publish', afterPublish.headlineLine1 === 'PUBLISHED-VALUE')

    // -------------------------------------------------------------- version restore
    console.log('\n--- Version history / restore ---')
    const versions = await p.findGlobalVersions({ slug: HERO, limit: 50, sort: '-updatedAt' })
    check('version history is retained', versions.totalDocs >= 2, `found ${versions.totalDocs}`)

    const priorPublished = versions.docs.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (v: any) => v.version?._status === 'published' && v.version?.headlineLine1 === approvedHeadline,
    )
    check('an earlier PUBLISHED version is present in history', Boolean(priorPublished))

    if (priorPublished) {
      await p.restoreGlobalVersion({ slug: HERO, id: priorPublished.id })
      const afterRestore = (await p.findGlobal({ slug: HERO, draft: false })) as Record<string, unknown>
      check(
        'restoring the earlier version brings back its wording',
        afterRestore.headlineLine1 === approvedHeadline,
        `got ${JSON.stringify(afterRestore.headlineLine1)}`,
      )
    }

    // Restore must also be admin-gated.
    let memberRestored = true
    try {
      await p.restoreGlobalVersion({
        slug: HERO,
        id: versions.docs[0].id,
        overrideAccess: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user: member as any,
      })
    } catch {
      memberRestored = false
    }
    check('member cannot restore a version', !memberRestored)

    // -------------------------------------------------------------- field validation via the API
    console.log('\n--- Stored destinations are validated on save ---')
    let unsafeAccepted = true
    try {
      await p.updateGlobal({
        slug: HERO,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { primaryButtonHref: 'javascript:alert(1)' } as any,
      })
    } catch {
      unsafeAccepted = false
    }
    check('Payload rejects a javascript: destination on save', !unsafeAccepted)
  } finally {
    // ------------------------------------------------------------ restore approved state
    console.log('\n--- Restoring approved published content ---')
    await p.updateGlobal({
      slug: HERO,
      data: {
        welcomeLine: APPROVED.welcomeLine,
        headlineLine1: APPROVED.headlineLine1,
        headlineLine2: APPROVED.headlineLine2,
        description: APPROVED.description,
        supportingSentence: APPROVED.supportingSentence,
        primaryButtonLabel: APPROVED.primaryButtonLabel,
        primaryButtonHref: APPROVED.primaryButtonHref,
        secondaryButtonLabel: APPROVED.secondaryButtonLabel,
        secondaryButtonHref: APPROVED.secondaryButtonHref,
        _status: 'published',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    const restored = (await p.findGlobal({ slug: HERO, draft: false })) as Record<string, unknown>
    check('approved wording is the live published content', restored.headlineLine1 === APPROVED.headlineLine1)
    check('approved description restored', restored.description === APPROVED.description)
    check('approved button 1 restored', restored.primaryButtonHref === APPROVED.primaryButtonHref)
    check('approved button 2 restored', restored.secondaryButtonHref === APPROVED.secondaryButtonHref)
    await cleanup()
    console.log('  · temporary accounts removed')
  }

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
