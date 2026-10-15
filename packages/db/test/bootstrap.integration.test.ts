import { eq, sql } from 'drizzle-orm';
import { pgTable, serial, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client';
import { runMigrations } from '../src/scripts/migrate';
import { geographyPoint } from '../src/types/geography';
import { testAppUrl, testMigratorUrl } from './helpers';

const probes = pgTable('m0_geo_probe', {
  id: serial().primaryKey(),
  label: text().notNull(),
  location: geographyPoint().notNull(),
});

const owner = createDb(testMigratorUrl, { max: 1 });
const app = createDb(testAppUrl, { max: 1 });

beforeAll(async () => {
  await runMigrations(testMigratorUrl);
  // Idempotent: a second run must be a no-op.
  await runMigrations(testMigratorUrl);

  await owner.client`DROP TABLE IF EXISTS m0_geo_probe, m0_append_probe`;
  await owner.client`
    CREATE TABLE m0_geo_probe (
      id serial PRIMARY KEY,
      label text NOT NULL,
      location geography(Point, 4326) NOT NULL
    )`;
  await owner.client`CREATE TABLE m0_append_probe (id serial PRIMARY KEY, note text NOT NULL)`;
  await owner.client`SELECT jobbank_make_append_only('m0_append_probe')`;
});

afterAll(async () => {
  await owner.client`DROP TABLE IF EXISTS m0_geo_probe, m0_append_probe`;
  await Promise.all([owner.client.end(), app.client.end()]);
});

describe('bootstrap migration', () => {
  it('installs postgis, pgcrypto and citext', async () => {
    const rows = await owner.client<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'pgcrypto', 'citext')`;
    expect(rows.map((r) => r.extname).sort()).toEqual(['citext', 'pgcrypto', 'postgis']);
  });
});

describe('geographyPoint column', () => {
  it('round-trips coordinates through the app role', async () => {
    const [inserted] = await app.db
      .insert(probes)
      .values({ label: 'Saylani HQ', location: { lat: 24.8607, lng: 67.0011 } })
      .returning();
    expect(inserted?.location).toEqual({ lat: 24.8607, lng: 67.0011 });

    const [read] = await app.db.select().from(probes).where(eq(probes.label, 'Saylani HQ'));
    expect(read?.location).toEqual({ lat: 24.8607, lng: 67.0011 });
  });

  it('matches the PostGIS EWKB encoding used by the unit fixture', async () => {
    const [row] = await app.client<{ hex: string }[]>`
      SELECT ST_SetSRID(ST_MakePoint(67.0011, 24.8607), 4326)::geography::text AS hex`;
    expect(row?.hex.toUpperCase()).toBe('0101000020E6100000A301BC0512C05040CEAACFD556DC3840');
  });

  it('computes geodesic distances in metres', async () => {
    // ~1 km due north of the HQ probe (1° latitude ≈ 110.574 km at the equator, ~110.7 km here).
    await app.db
      .insert(probes)
      .values({ label: 'one-km-north', location: { lat: 24.8607 + 0.009034, lng: 67.0011 } });

    const [row] = await app.db.execute<{ metres: number }>(sql`
      SELECT ST_Distance(a.location, b.location) AS metres
      FROM m0_geo_probe a, m0_geo_probe b
      WHERE a.label = 'Saylani HQ' AND b.label = 'one-km-north'`);
    expect(Number(row?.metres)).toBeGreaterThan(995);
    expect(Number(row?.metres)).toBeLessThan(1005);
  });
});

describe('jobbank helpers', () => {
  it('ignores missing relations when attaching triggers or append-only guards', async () => {
    await expect(
      owner.client`SELECT jobbank_attach_updated_at('missing_table_should_not_exist')`,
    ).resolves.toBeDefined();
    await expect(
      owner.client`SELECT jobbank_make_append_only('missing_table_should_not_exist')`,
    ).resolves.toBeDefined();
  });
});

describe('jobbank_make_append_only', () => {
  it('lets the app role insert and read', async () => {
    await app.client`INSERT INTO m0_append_probe (note) VALUES ('first')`;
    const rows = await app.client`SELECT note FROM m0_append_probe`;
    expect(rows).toHaveLength(1);
  });

  it('denies UPDATE/DELETE to the app role at the privilege level', async () => {
    await expect(app.client`UPDATE m0_append_probe SET note = 'changed'`).rejects.toMatchObject({
      code: '42501',
    });
    await expect(app.client`DELETE FROM m0_append_probe`).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('blocks even the owner via trigger with SQLSTATE JB001', async () => {
    await expect(owner.client`UPDATE m0_append_probe SET note = 'changed'`).rejects.toMatchObject({
      code: 'JB001',
    });
    await expect(owner.client`DELETE FROM m0_append_probe`).rejects.toMatchObject({
      code: 'JB001',
    });
    await expect(owner.client`TRUNCATE m0_append_probe`).rejects.toMatchObject({
      code: 'JB001',
    });
  });
});
