import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPLICATION_STATUSES } from '../src/schema/applications';
import { migrationsFolder } from '../src/scripts/migrate';

describe('migration files', () => {
  it('registers every SQL migration in the journal', () => {
    const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    const migrationFiles = readdirSync(migrationsFolder)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.slice(0, -'.sql'.length))
      .sort();
    const journalTags = journal.entries.map((entry) => entry.tag).sort();

    expect(journalTags).toEqual(migrationFiles);
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index),
    );
  });

  // 0053: the schema list in applications.ts is NOT the only source of
  // truth — Postgres also enforces `applications_status_check` (0015,
  // rewritten 0020/0021). 0052 added INTERVIEW_PASSED/INTERVIEW_FAILED to
  // the schema list only, so recording an outcome failed in the live DB
  // with 23514 ("Status is not allowed.") while every unit test passed.
  // This test fails if a future status is added to the schema list
  // without updating the CHECK in the newest status migration.
  it('applications_status_check covers every APPLICATION_STATUSES value', () => {
    const sql = readFileSync(`${migrationsFolder}/0053_interview_outcome_status_check.sql`, 'utf8');
    for (const status of APPLICATION_STATUSES) {
      expect(sql, `applications_status_check is missing ${status}`).toContain(`'${status}'`);
    }
  });

  // drizzle-kit quotes custom types like geography(Point, 4326) as identifiers, which
  // Postgres rejects. Every generated migration must be fixed by hand — this catches it.
  it('never quote the PostGIS geography type', () => {
    const offenders = readdirSync(migrationsFolder)
      .filter((file) => file.endsWith('.sql'))
      .filter((file) => /"geography\(/.test(readFileSync(`${migrationsFolder}/${file}`, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
