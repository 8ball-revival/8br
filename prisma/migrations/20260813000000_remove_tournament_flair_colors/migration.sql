-- Remove per-tournament FLAIR color/banner controls.
--
-- Color is now a PERSONAL ACCOUNT theme (payload.users.themeType / themeMainColor / themeAccentColor;
-- see src/lib/theme), not a tournament-level setting. The application no longer reads or writes these
-- columns. Safe/idempotent (IF EXISTS). Keeps the surviving flair columns (`description`, `badge`).
--
-- NOT auto-applied to production — deploy only with explicit approval.

ALTER TABLE "comp_tournament" DROP COLUMN IF EXISTS "bannerImageUrl";
ALTER TABLE "comp_tournament" DROP COLUMN IF EXISTS "accentPreset";

ALTER TABLE "tournament_flair_default" DROP COLUMN IF EXISTS "bannerImageUrl";
ALTER TABLE "tournament_flair_default" DROP COLUMN IF EXISTS "accentPreset";
