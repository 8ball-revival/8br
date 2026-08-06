-- Additive: add the BRACKET_GENERATED lifecycle state between REGISTRATION_CLOSED and IN_PROGRESS.
-- Enum value additions are non-destructive; existing rows and stored values are unaffected.
ALTER TYPE "CupLifecycleState" ADD VALUE IF NOT EXISTS 'BRACKET_GENERATED' AFTER 'REGISTRATION_CLOSED';
