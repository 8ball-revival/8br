-- Versioned canonical Cup snapshot (DB-backed derived-data revision). Additive.
CREATE TABLE "comp_cup_snapshot" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "comp_cup_snapshot_pkey" PRIMARY KEY ("id")
);
