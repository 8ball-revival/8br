-- Scheduled publication, and revision history for templates.
--
-- Every statement is additive: four nullable columns on an existing table, one new table, two new
-- indexes. Nothing is dropped, renamed, retyped or backfilled, and no existing row is written to.

-- What the scheduler did, and when, and why it did not.
ALTER TABLE "site_page_revision" ADD COLUMN "activatedAt" TIMESTAMP(3);
ALTER TABLE "site_page_revision" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "site_page_revision" ADD COLUMN "cancelledByUsername" TEXT;
ALTER TABLE "site_page_revision" ADD COLUMN "activationError" TEXT;

-- Templates are edited directly now, so they need the same recourse a page has.
CREATE TABLE "site_template_revision" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "createdByUsername" TEXT,

    CONSTRAINT "site_template_revision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "site_template_revision_templateId_createdAt_idx" ON "site_template_revision"("templateId", "createdAt");
CREATE UNIQUE INDEX "site_template_revision_templateId_number_key" ON "site_template_revision"("templateId", "number");
CREATE INDEX "site_template_archivedAt_idx" ON "site_template"("archivedAt");

ALTER TABLE "site_template_revision" ADD CONSTRAINT "site_template_revision_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "site_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The scheduler's hot query: "which scheduled revisions are due?" There is already an index on
-- (state, scheduledFor); this one narrows the sweep that runs on a request path.
CREATE INDEX IF NOT EXISTS "site_page_revision_state_scheduledFor_idx" ON "site_page_revision"("state", "scheduledFor");
