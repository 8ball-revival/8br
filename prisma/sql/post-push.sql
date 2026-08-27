-- Run AFTER `prisma db push`, to restore the one thing Prisma's schema language cannot express.
--
-- `break_post."searchVector"` is a STORED GENERATED column: Postgres recomputes it from the title,
-- author and body on every write, which is what makes search an index scan instead of an ILIKE over
-- every post. Prisma has no syntax for a generated column. schema.prisma declares the column (as
-- Unsupported, so `db push` stops dropping it) but a push against a database that does not already
-- have it creates it PLAIN -- a column that is always NULL, so search silently matches nothing.
--
-- This asserts the generated-ness rather than the column's existence, and is idempotent: when the
-- column is already GENERATED ALWAYS it does nothing at all.
DO $$
DECLARE
  generated_state text;
BEGIN
  SELECT is_generated INTO generated_state
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'break_post' AND column_name = 'searchVector';

  IF generated_state IS DISTINCT FROM 'ALWAYS' THEN
    -- Dropping loses nothing: every value is derived from columns that are still there.
    IF generated_state IS NOT NULL THEN
      ALTER TABLE "break_post" DROP COLUMN "searchVector";
    END IF;

    ALTER TABLE "break_post"
      ADD COLUMN "searchVector" tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("authorNameSnapshot", '')), 'B') ||
        setweight(to_tsvector('english', coalesce("authorHandleSnapshot", '')), 'B') ||
        setweight(to_tsvector('english', coalesce("bodyText", '')), 'C')
      ) STORED;

    RAISE NOTICE 'break_post."searchVector" restored as a generated column';
  END IF;
END $$;

-- Dropping the column above takes its index with it; this puts it back. Harmless when the push
-- already created it from the schema declaration.
CREATE INDEX IF NOT EXISTS "break_post_searchVector_idx" ON "break_post" USING GIN ("searchVector");
