-- The avatar frame: a circle, or a square with rounded corners.
--
-- Additive and defaulted, so every existing profile keeps exactly the circle it has today and the
-- column can be added to a live database without a rewrite or a moment where a profile has no shape.
ALTER TABLE "Player" ADD COLUMN "avatarShape" TEXT NOT NULL DEFAULT 'CIRCLE';
