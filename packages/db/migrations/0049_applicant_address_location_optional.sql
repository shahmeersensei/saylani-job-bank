-- Home location pin is optional (2026-11-16): the staff registration form
-- no longer collects a home location, so new registrations have no pin.
-- Existing pins are untouched, and the staff profile-update path preserves
-- a stored pin when the submitted location is null.
ALTER TABLE "applicant_addresses" ALTER COLUMN "location" DROP NOT NULL;
