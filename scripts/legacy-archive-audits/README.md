# Legacy archive audits

These four suites belong to the **retired** archive reconstruction pipeline. They are kept because
they are the record of how the 8BRCAM archive was imported and checked, and deleting them would
erase that. They are not part of `npm run verify`.

| Suite | What it audits |
| --- | --- |
| `verify-archive-shells.mts` | The generated archive shell Seasons and their privacy |
| `verify-archive-entrants-playoffs.mts` | The manifest and refusals of the entrant/playoff importer |
| `verify-archive-entrants-playoffs-apply.mts` | The importer's WRITES, against a throwaway Season |
| `verify-place-entrants.mts` | Which archive Seasons have exact placements and which have participants only |

## Why they are excluded

Two reasons, and either alone would be enough.

They exercise **tooling nobody may run**. The archive importers are retired; every entry point
refuses on import (`scripts/_retired.mjs`). A suite proving a forbidden tool behaves correctly cannot
block a deployment.

They **require the archive itself**. Their assertions are about specific imported Seasons, shells and
placements, which exist only in production. Development runs on invented fixtures, so these can never
pass there — and making them pass would mean either shipping a copy of production to every developer
or hollowing the assertions out until they proved nothing.

## They have not been weakened

Not one assertion was changed, relaxed or deleted. The files are exactly as they were; only their
location changed. `verify-archive-entrants-playoffs-apply.mts` has five failing checks that predate
all of this work — an ambiguous-handle case left unfinished when archive reconstruction was halted —
and those failures are preserved rather than papered over.

To run one deliberately, against a database that has the archive:

```bash
npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=<your env> scripts/legacy-archive-audits/<suite>.mts
```
