-- CreateEnum
CREATE TYPE "SitePageKind" AS ENUM ('STATIC', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "SiteRevisionState" AS ENUM ('DRAFT', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "site_page" (
    "id" TEXT NOT NULL,
    "kind" "SitePageKind" NOT NULL DEFAULT 'STATIC',
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scopePlatform" TEXT,
    "scopeSeriesId" INTEGER,
    "scopeEntityId" INTEGER,
    "parentId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "publishedRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_page_draft" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "dirty" BOOLEAN NOT NULL DEFAULT false,
    "lastEditorId" INTEGER,
    "lastEditorUsername" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_page_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_page_revision" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "state" "SiteRevisionState" NOT NULL DEFAULT 'PUBLISHED',
    "summary" TEXT,
    "previousRevisionId" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" INTEGER,
    "publishedByUsername" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "site_page_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_reusable_module" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "moduleType" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "style" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUsername" TEXT,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "site_reusable_module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" TEXT NOT NULL,
    "category" TEXT,
    "document" JSONB NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUsername" TEXT,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "site_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_theme_profile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "tokens" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUsername" TEXT,

    CONSTRAINT "site_theme_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_trash_item" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pageId" TEXT,
    "label" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedByUsername" TEXT,
    "purgeAfter" TIMESTAMP(3),

    CONSTRAINT "site_trash_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_builder_pref" (
    "userId" INTEGER NOT NULL,
    "preferences" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_builder_pref_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_page_key_key" ON "site_page"("key");

-- CreateIndex
CREATE UNIQUE INDEX "site_page_publishedRevisionId_key" ON "site_page"("publishedRevisionId");

-- CreateIndex
CREATE INDEX "site_page_kind_enabled_idx" ON "site_page"("kind", "enabled");

-- CreateIndex
CREATE INDEX "site_page_scopePlatform_scopeSeriesId_scopeEntityId_idx" ON "site_page"("scopePlatform", "scopeSeriesId", "scopeEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "site_page_draft_pageId_key" ON "site_page_draft"("pageId");

-- CreateIndex
CREATE INDEX "site_page_revision_pageId_publishedAt_idx" ON "site_page_revision"("pageId", "publishedAt");

-- CreateIndex
CREATE INDEX "site_page_revision_state_scheduledFor_idx" ON "site_page_revision"("state", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "site_page_revision_pageId_number_key" ON "site_page_revision"("pageId", "number");

-- CreateIndex
CREATE INDEX "site_reusable_module_moduleType_idx" ON "site_reusable_module"("moduleType");

-- CreateIndex
CREATE INDEX "site_template_scope_idx" ON "site_template"("scope");

-- CreateIndex
CREATE INDEX "site_theme_profile_active_idx" ON "site_theme_profile"("active");

-- CreateIndex
CREATE INDEX "site_trash_item_kind_deletedAt_idx" ON "site_trash_item"("kind", "deletedAt");

-- AddForeignKey
ALTER TABLE "site_page" ADD CONSTRAINT "site_page_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "site_page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_page" ADD CONSTRAINT "site_page_publishedRevisionId_fkey" FOREIGN KEY ("publishedRevisionId") REFERENCES "site_page_revision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_page_draft" ADD CONSTRAINT "site_page_draft_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "site_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_page_revision" ADD CONSTRAINT "site_page_revision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "site_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

