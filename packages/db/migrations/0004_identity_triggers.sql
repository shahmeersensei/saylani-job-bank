-- Keep updated_at accurate for writes that bypass the ORM.
-- Upgrade helpers installed by 0000_bootstrap. Existing databases have already
-- recorded that migration, so changing its function signatures alone is not enough.
DROP FUNCTION IF EXISTS jobbank_attach_updated_at(regclass);
--> statement-breakpoint
DROP FUNCTION IF EXISTS jobbank_make_append_only(regclass);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION jobbank_attach_updated_at(target text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  target_relation regclass := to_regclass(target);
BEGIN
  IF target_relation IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format('DROP TRIGGER IF EXISTS jobbank_updated_at ON %s', target_relation);
  EXECUTE format(
    'CREATE TRIGGER jobbank_updated_at BEFORE UPDATE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION jobbank_set_updated_at()', target_relation);
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION jobbank_make_append_only(target text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  target_relation regclass := to_regclass(target);
BEGIN
  IF target_relation IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format('DROP TRIGGER IF EXISTS jobbank_append_only ON %s', target_relation);
  EXECUTE format(
    'CREATE TRIGGER jobbank_append_only BEFORE UPDATE OR DELETE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION jobbank_reject_mutation()', target_relation);
  EXECUTE format('DROP TRIGGER IF EXISTS jobbank_append_only_truncate ON %s', target_relation);
  EXECUTE format(
    'CREATE TRIGGER jobbank_append_only_truncate BEFORE TRUNCATE ON %s '
    'FOR EACH STATEMENT EXECUTE FUNCTION jobbank_reject_mutation()', target_relation);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM app_rw', target_relation);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION jobbank_attach_updated_at(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION jobbank_make_append_only(text) FROM PUBLIC;
--> statement-breakpoint
SELECT jobbank_attach_updated_at('users');
--> statement-breakpoint
SELECT jobbank_attach_updated_at('sessions');
--> statement-breakpoint
SELECT jobbank_attach_updated_at('accounts');
--> statement-breakpoint
SELECT jobbank_attach_updated_at('verifications');
--> statement-breakpoint
SELECT jobbank_attach_updated_at('branches');
--> statement-breakpoint
-- Emails are unique regardless of case (Better Auth lowercases, but imports/admin writes may not).
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email));
--> statement-breakpoint
-- Phone numbers are stored in E.164 (+923001234567).
ALTER TABLE users ADD CONSTRAINT users_phone_e164 CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{7,14}$');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS branches_location_gix ON branches USING gist (location);
