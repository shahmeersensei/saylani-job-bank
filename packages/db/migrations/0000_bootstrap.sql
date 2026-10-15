-- M0 bootstrap: extensions, runtime-role privileges and shared trigger helpers.
-- Runs as the owner/migrator role. The runtime role `app_rw` never owns objects.

CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint

-- In local dev docker creates app_rw WITH LOGIN (infra/postgres/init). Elsewhere infra
-- provisions it; this placeholder only guarantees the GRANTs below never fail.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_rw;
--> statement-breakpoint
GRANT SELECT ON TABLE spatial_ref_sys TO app_rw;
--> statement-breakpoint
-- Every table/sequence created later by the migrator is usable by the app by default.
-- Append-only tables narrow this with jobbank_make_append_only().
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
--> statement-breakpoint

-- Keeps updated_at honest even for writes that bypass the ORM.
CREATE OR REPLACE FUNCTION jobbank_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION jobbank_attach_updated_at(target text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Some environments resume from a partially applied migration set. A missing table
  -- is not a fatal condition for the migration bootstrap: the table will be created by
  -- its later migration and the trigger can be installed then.
  IF to_regclass(target) IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format('DROP TRIGGER IF EXISTS jobbank_updated_at ON %s', target);
  EXECUTE format(
    'CREATE TRIGGER jobbank_updated_at BEFORE UPDATE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION jobbank_set_updated_at()', target);
END
$$;
--> statement-breakpoint

-- PRD §7.2: audit logs and decision tables are append-only.
-- SQLSTATE JB001 lets the API map this to a 409 instead of a 500.
CREATE OR REPLACE FUNCTION jobbank_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table "%" is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'JB001';
END
$$;
--> statement-breakpoint
-- Two independent guards: a trigger (blocks everyone, including the owner) and
-- revoked privileges (blocks the app role even if the trigger is ever dropped).
CREATE OR REPLACE FUNCTION jobbank_make_append_only(target text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Same partial-migration guard: skip append-only protection for tables not yet created.
  IF to_regclass(target) IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format('DROP TRIGGER IF EXISTS jobbank_append_only ON %s', target);
  EXECUTE format(
    'CREATE TRIGGER jobbank_append_only BEFORE UPDATE OR DELETE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION jobbank_reject_mutation()', target);
  EXECUTE format('DROP TRIGGER IF EXISTS jobbank_append_only_truncate ON %s', target);
  EXECUTE format(
    'CREATE TRIGGER jobbank_append_only_truncate BEFORE TRUNCATE ON %s '
    'FOR EACH STATEMENT EXECUTE FUNCTION jobbank_reject_mutation()', target);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM app_rw', target);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION jobbank_attach_updated_at(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION jobbank_make_append_only(text) FROM PUBLIC;
