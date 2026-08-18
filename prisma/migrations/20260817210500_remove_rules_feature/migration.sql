-- Remove the competition Rules feature's only footprint in the Prisma-owned schema.
--
-- `Competition.rulesRef` held the slug of a Payload Rules document and had no other purpose, so it
-- goes with the feature. Everything else on Competition describes the competition itself and is
-- untouched. The column was null in every row when this was written.
--
-- The Payload-owned tables (payload.rules, payload._rules_v and the rules_id column on the shared
-- payload_locked_documents_rels) are dropped by the Payload migration
-- src/migrations/20260817_210000_remove_rules.ts, which is the workflow that owns that schema.
ALTER TABLE "public"."Competition" DROP COLUMN IF EXISTS "rulesRef";
