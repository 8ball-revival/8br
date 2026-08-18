-- Site settings key/value store, plus registration-mode support.
--
-- Two things are going on here.
--
-- 1. `site_setting` is READ AND WRITTEN by src/lib/staff/site-settings.ts through raw SQL, but no
--    migration ever created it and no Prisma model declares it. /staff/settings therefore threw on
--    any database where it had not been created by hand. This creates it, idempotently, so the
--    existing Site Settings screen works.
--
-- 2. It is also where the "Create an Account" mode lives. A key/value row rather than a new column
--    because that is what this table is for, and because the registration code must NOT be readable
--    through the generic settings reader: that reader only returns keys listed in SETTINGS_FIELDS,
--    and the code is deliberately not one of them.
CREATE TABLE IF NOT EXISTS public.site_setting (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Failed registration-code attempts, for a modest rate limit.
--
-- Counted in the database rather than in process memory: a counter that resets on restart is not a
-- limit, and this application runs more than one instance. Only failures are recorded, and only a
-- one-way hash of the client address - never an address itself, and never the submitted code.
CREATE TABLE IF NOT EXISTS public.registration_attempt (
  id          BIGSERIAL PRIMARY KEY,
  client_hash TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS registration_attempt_client_created_idx
  ON public.registration_attempt (client_hash, "createdAt");
