-- Matching performance (Phase 1.5):
-- 1) Profile-version triggers: any change to profile data bumps applicants.updated_at
--    so the engine's Redis profile cache (keyed by id + updated_at) invalidates at once.
-- 2) pg_notify on match_outbox: the Python worker LISTENs and starts the run in ~ms
--    instead of waiting for the 2s poll (kept as fallback).

CREATE OR REPLACE FUNCTION jobbank_profile_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  aid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    aid := OLD.applicant_id;
  ELSE
    aid := NEW.applicant_id;
  END IF;
  IF aid IS NOT NULL THEN
    UPDATE applicants SET updated_at = now() WHERE id = aid;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION jobbank_profile_touch() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS jobbank_profile_touch ON applicant_skills;
--> statement-breakpoint
CREATE TRIGGER jobbank_profile_touch AFTER INSERT OR UPDATE OR DELETE
  ON applicant_skills FOR EACH ROW EXECUTE FUNCTION jobbank_profile_touch();
--> statement-breakpoint
DROP TRIGGER IF EXISTS jobbank_profile_touch ON applicant_languages;
--> statement-breakpoint
CREATE TRIGGER jobbank_profile_touch AFTER INSERT OR UPDATE OR DELETE
  ON applicant_languages FOR EACH ROW EXECUTE FUNCTION jobbank_profile_touch();
--> statement-breakpoint
DROP TRIGGER IF EXISTS jobbank_profile_touch ON applicant_education;
--> statement-breakpoint
CREATE TRIGGER jobbank_profile_touch AFTER INSERT OR UPDATE OR DELETE
  ON applicant_education FOR EACH ROW EXECUTE FUNCTION jobbank_profile_touch();
--> statement-breakpoint
DROP TRIGGER IF EXISTS jobbank_profile_touch ON applicant_experience;
--> statement-breakpoint
CREATE TRIGGER jobbank_profile_touch AFTER INSERT OR UPDATE OR DELETE
  ON applicant_experience FOR EACH ROW EXECUTE FUNCTION jobbank_profile_touch();
--> statement-breakpoint
DROP TRIGGER IF EXISTS jobbank_profile_touch ON applicant_preferences;
--> statement-breakpoint
CREATE TRIGGER jobbank_profile_touch AFTER INSERT OR UPDATE OR DELETE
  ON applicant_preferences FOR EACH ROW EXECUTE FUNCTION jobbank_profile_touch();
--> statement-breakpoint
DROP TRIGGER IF EXISTS jobbank_profile_touch ON applicant_addresses;
--> statement-breakpoint
CREATE TRIGGER jobbank_profile_touch AFTER INSERT OR UPDATE OR DELETE
  ON applicant_addresses FOR EACH ROW EXECUTE FUNCTION jobbank_profile_touch();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION jobbank_match_outbox_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('match_outbox', json_build_object(
    'job_id', NEW.payload ->> 'job_id',
    'event', NEW.event_type
  )::text);
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION jobbank_match_outbox_notify() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS match_outbox_notify ON match_outbox;
--> statement-breakpoint
CREATE TRIGGER match_outbox_notify AFTER INSERT ON match_outbox
  FOR EACH ROW EXECUTE FUNCTION jobbank_match_outbox_notify();
