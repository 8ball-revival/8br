/**
 * The deploy may not destroy working database objects.
 *
 * `scripts/deploy-migrate.mjs` reconciles the database to schema.prisma with
 * `prisma db push --accept-data-loss`. That flag is there for a real reason -- this project's early
 * renames were applied by hand and never captured as migration files, so a replay against a fresh
 * database fails and the push is what makes a deploy work at all. The cost is that anything the
 * database has and the schema does not know about is fair game to be dropped.
 *
 * Seven objects were in exactly that position: The Break's generated tsvector column and its GIN
 * index, two trigram indexes, the three per-platform ladder indexes, a unique key and the composite
 * foreign key that stops a poll vote naming another poll's option. Every one was created by raw SQL
 * in a migration and none appeared in schema.prisma, so each deploy was free to drop them.
 *
 * They are declared in the schema now. This suite is what keeps them declared: it asserts the
 * objects exist locally, that the reconciliation the schema language cannot express is still wired
 * into the deploy, and that the diff the deploy would apply drops nothing it does not put back.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

const one = async (sql: string) => (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql))[0]

console.log('--- The objects the deploy used to be free to drop ---')

const gen = await one(`select coalesce((select is_generated from information_schema.columns
  where table_schema='public' and table_name='break_post' and column_name='searchVector'), 'ABSENT') as state`)
check('break_post."searchVector" is a STORED GENERATED column', gen.state === 'ALWAYS',
  `is_generated = ${gen.state}. A plain column is always NULL, so search matches nothing and says nothing`)

const gin = await one(`select count(*)::int as n from pg_indexes
  where tablename='break_post' and indexdef ilike '%gin%'`)
check('...and The Break keeps its three GIN indexes (search + two trigram)', gin.n === 3, `${gin.n} of 3`)

const plat = await one(`select count(*)::int as n from pg_indexes where indexdef ilike '%(platform)%'`)
check('the three per-platform ladder indexes are present', plat.n === 3, `${plat.n} of 3`)

const uniq = await one(`select count(*)::int as n from pg_indexes
  where tablename='break_poll_option' and indexdef ilike '%unique%' and indexdef ilike '%pollid%'`)
check('a poll option is unique on (id, pollId)', uniq.n === 1, `${uniq.n} found`)

const fk = await one(`select count(*)::int as n from pg_constraint
  where conrelid='break_poll_vote'::regclass and contype='f' and array_length(conkey,1)=2`)
check('...so a vote cannot name an option from another poll', fk.n === 1,
  'the composite foreign key (optionId, pollId) is missing')

console.log('\n--- The reconciliation the schema language cannot express ---')

const deploy = readFileSync('scripts/deploy-migrate.mjs', 'utf8')
const pushAt = deploy.indexOf("'npx prisma db push")
const preAt = deploy.indexOf('pre-push.sql')
const postAt = deploy.indexOf('post-push.sql')
check('the deploy creates the extensions the schema depends on BEFORE pushing',
  preAt > -1 && preAt < pushAt, 'gin_trgm_ops does not exist until pg_trgm does, and the push creates those indexes')
check('...and restores the generated column AFTER pushing',
  postAt > -1 && postAt > pushAt, 'a push against a fresh database creates searchVector plain')
check('pre-push installs pg_trgm', /CREATE EXTENSION IF NOT EXISTS pg_trgm/i.test(readFileSync('prisma/sql/pre-push.sql', 'utf8')))
const post = readFileSync('prisma/sql/post-push.sql', 'utf8')
check('post-push asserts generated-ness rather than mere existence', /is_generated/.test(post) && /GENERATED ALWAYS AS/.test(post))
check('...and puts the GIN index back with the column', /CREATE INDEX IF NOT EXISTS "break_post_searchVector_idx"/.test(post))

console.log('\n--- What the deploy would actually apply ---')

/*
 * The diff is the deploy. Asking Prisma for it is the only honest way to check what `db push` will
 * do, because the push decides for itself and a hand-maintained list of expected statements would
 * drift the moment the schema changed.
 */
const url = process.env.DATABASE_URL!
let script = ''
try {
  script = execSync(
    `npx prisma migrate diff --from-url "${url}" --to-schema-datamodel prisma/schema.prisma --script`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
} catch (err: unknown) {
  check('the diff could be computed', false, String((err as Error)?.message).slice(0, 120))
}

if (script) {
  const stmts = script.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('--'))
  const dropsColumn = stmts.filter((l) => /DROP COLUMN/i.test(l))
  const dropsTable = stmts.filter((l) => /^DROP TABLE/i.test(l))
  const dropsIndex = stmts.filter((l) => /^DROP INDEX/i.test(l))
  check('it drops no column', dropsColumn.length === 0, dropsColumn.join(' | '))
  check('it drops no table', dropsTable.length === 0, dropsTable.join(' | '))
  check('it drops no index', dropsIndex.length === 0, dropsIndex.join(' | '))

  /*
   * A dropped constraint is only acceptable when the same script adds one back -- which is what a
   * rename looks like in this form, and is how the composite foreign key survives being renamed to
   * Prisma's own convention.
   */
  const droppedOn = (t: string) => stmts.filter((l) => /DROP CONSTRAINT/i.test(l) && l.includes(t))
  const addsComposite = stmts.some((l) =>
    /ADD CONSTRAINT/i.test(l) && l.includes('break_poll_vote') && /FOREIGN KEY \("optionId", "pollId"\)/i.test(l))
  /*
   * Counting drops against adds would fail here for the right reason and the wrong one: the diff
   * drops TWO foreign keys on break_poll_vote and adds ONE. That is the correct trade -- the
   * single-column key is subsumed by the composite, which is strictly stronger -- so what matters is
   * not the arithmetic but whether the guarantee survives.
   */
  const voteDrops = droppedOn('break_poll_vote')
  check('the poll-vote guarantee survives the reconciliation',
    voteDrops.length === 0 || addsComposite,
    `${voteDrops.length} constraint(s) dropped on break_poll_vote and no composite key added back`)

  const otherDrops = stmts.filter((l) => /DROP CONSTRAINT/i.test(l) && !l.includes('break_poll_vote'))
  check('...and nothing else has a constraint dropped', otherDrops.length === 0, otherDrops.join(' | '))
}

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
