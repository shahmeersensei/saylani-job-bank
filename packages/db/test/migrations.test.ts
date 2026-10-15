import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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

  // drizzle-kit quotes custom types like geography(Point, 4326) as identifiers, which
  // Postgres rejects. Every generated migration must be fixed by hand — this catches it.
  it('never quote the PostGIS geography type', () => {
    const offenders = readdirSync(migrationsFolder)
      .filter((file) => file.endsWith('.sql'))
      .filter((file) => /"geography\(/.test(readFileSync(`${migrationsFolder}/${file}`, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
