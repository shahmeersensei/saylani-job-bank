-- Migration: add benefits/perks columns + reopened_at to jobs table

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS reopened_at         timestamptz,
  ADD COLUMN IF NOT EXISTS fuel_allowance      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flexible_hours      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS annual_leave_days   smallint,
  ADD COLUMN IF NOT EXISTS medical_coverage    text        NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS bonus_tier          text        NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS work_from_home      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provident_fund      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transport_allowance boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eobi                boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS life_insurance      boolean     NOT NULL DEFAULT false;
