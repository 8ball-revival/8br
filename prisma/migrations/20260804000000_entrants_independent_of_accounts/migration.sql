-- Tournament entrants are independent of website accounts.
-- userId becomes optional (admin-added, account-less entrants); a profile can only
-- be entered once per season; track whether an entrant was added by an admin.

-- AlterTable
ALTER TABLE "comp_registration" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "comp_registration" ADD COLUMN "addedByAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex (a profile may enter a season only once; NULL playerId rows are distinct)
CREATE UNIQUE INDEX "comp_registration_seasonId_playerId_key" ON "comp_registration"("seasonId", "playerId");
