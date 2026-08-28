-- The Break: removing posting from a member who abuses it.
--
-- A REVOCATION, not a grant. Posting is open to every member in good standing, so the default is
-- false and nothing has to be done to an existing or a new account for them to be able to write.
-- That is also why this is safe to apply to a populated database: every one of the 516 existing
-- Players keeps exactly the access they have today.
--
-- Deliberately separate from the account-wide penalties in member_penalty. A timeout or a ban
-- removes the whole account; this removes posting and leaves reading, commenting, voting and saving
-- alone, so a posting problem no longer has to be answered by removing the person.
ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "breakPostingBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "breakPostingBlockedAt" TIMESTAMP(3);

-- Shown to the member when they try to post, so a removed permission is never a mystery they
-- cannot act on.
ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "breakPostingBlockedReason" TEXT;
