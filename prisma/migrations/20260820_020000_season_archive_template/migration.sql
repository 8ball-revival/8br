-- Link a reconstruction shell to its archive manifest entry.
--
-- Additive, nullable and backward compatible. Every existing Season keeps NULL, which is the honest
-- value: they were not built from the archive. The column holds a manifest KEY and never archive
-- data, so the manifest file remains the single source of truth for what the source said.
--
-- Deliberately NO competitionMonth column: the archive documents no month for any Season, so a field
-- that could only ever hold null would be schema pretending to knowledge that does not exist.

ALTER TABLE "season" ADD COLUMN "archiveTemplateKey" TEXT;

-- One shell per template. This is what makes the importer idempotent at the database level rather
-- than only in its own logic: a second run cannot create a duplicate even if its guard were wrong.
CREATE UNIQUE INDEX "season_archiveTemplateKey_key" ON "season"("archiveTemplateKey");
