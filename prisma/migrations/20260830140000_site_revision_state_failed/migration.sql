-- Adds the FAILED state for a scheduled revision the scheduler could not activate.
--
-- Alone in its own migration on purpose: PostgreSQL will not let a value added to an enum be USED
-- in the same transaction that added it, and Prisma runs each migration file in one transaction.
-- The next migration writes columns that reference this state, so it has to be a separate step.
--
-- Additive. No existing row changes; every existing state remains valid.
ALTER TYPE "SiteRevisionState" ADD VALUE 'FAILED';
