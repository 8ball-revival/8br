-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "avatarFilename" TEXT,
ADD COLUMN     "avatarFocalX" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "avatarFocalY" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "avatarUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "avatarZoom" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "rating_ledger" ADD COLUMN     "datePrecision" TEXT NOT NULL DEFAULT 'DAY',
ADD COLUMN     "occurredOn" TIMESTAMP(3),
ADD COLUMN     "occurredYear" INTEGER;

-- CreateTable
CREATE TABLE "player_profile_theme" (
    "playerId" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "accentSecondary" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "panelSurface" TEXT NOT NULL,
    "border" TEXT NOT NULL,
    "textPrimary" TEXT NOT NULL,
    "textMuted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_profile_theme_pkey" PRIMARY KEY ("playerId")
);

-- CreateIndex
CREATE INDEX "rating_ledger_occurredYear_idx" ON "rating_ledger"("occurredYear");

-- AddForeignKey
ALTER TABLE "player_profile_theme" ADD CONSTRAINT "player_profile_theme_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Backfill: the historical occurrence of every recorded match.
--
-- `completedAt` is when a result was ENTERED HERE. For the live 2026 season that is also when it was
-- played; for the imported archive it is when somebody typed a twenty-year-old result into this
-- application, which is why matches from 2005-2014 carried an August 2026 stamp.
--
-- The competition's own `competitionYear` is the dedicated historical source and was already
-- correct. So:
--   · the year always comes from the competition;
--   · the DAY is kept only where the stamp's year already agrees with the competition's year, which
--     is exactly the case where the result was entered in the year it was played;
--   · otherwise the day is discarded and the row is marked YEAR precision.
--
-- Nothing invents a month or a day, and no score, participant, rating or ordering is touched: the
-- deterministic `sequence` already runs in competitionYear order and is left alone.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

UPDATE "rating_ledger" l
SET "occurredYear"  = s."competitionYear",
    "occurredOn"    = CASE WHEN EXTRACT(YEAR FROM l."completedAt") = s."competitionYear"
                           THEN l."completedAt" ELSE NULL END,
    "datePrecision" = CASE WHEN EXTRACT(YEAR FROM l."completedAt") = s."competitionYear"
                           THEN 'DAY' ELSE 'YEAR' END
FROM "season" s
WHERE l."seasonId" = s."id";

UPDATE "rating_ledger" l
SET "occurredYear"  = t."competitionYear",
    "occurredOn"    = CASE WHEN EXTRACT(YEAR FROM l."completedAt") = t."competitionYear"
                           THEN l."completedAt" ELSE NULL END,
    "datePrecision" = CASE WHEN EXTRACT(YEAR FROM l."completedAt") = t."competitionYear"
                           THEN 'DAY' ELSE 'YEAR' END
FROM "comp_tournament" t
WHERE l."tournamentId" = t."id";

-- A row belonging to neither (there should be none) keeps DAY precision and its own stamp rather
-- than being given a year it cannot support.
