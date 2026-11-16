import { describe, expect, it } from 'vitest';
import {
  ddMmYyyyToIso,
  formatDate,
  formatDateTime,
  formatTime,
  isoToDdMmYyyy,
  parseDdMmYyyy,
} from './date';

describe('date formatting (Asia/Karachi, UTC+5, DD/MM/YYYY)', () => {
  it('formats in Pakistan time regardless of the machine zone', () => {
    // 12:30 UTC = 17:30 PKT
    expect(formatDateTime('2026-10-01T12:30:00Z')).toBe('01/10/2026, 5:30 pm');
    expect(formatTime('2026-10-01T12:30:00Z')).toBe('5:30 pm');
    // 21:00 UTC on 30 Sep = 02:00 PKT on 1 Oct
    expect(formatDate('2026-09-30T21:00:00Z')).toBe('01/10/2026');
  });

  it('zero-pads day and month', () => {
    expect(formatDate('2026-01-05T00:00:00Z')).toBe('05/01/2026');
  });
});

describe('parseDdMmYyyy', () => {
  it('parses a real date to a UTC midnight', () => {
    expect(parseDdMmYyyy('01/10/2026')?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(parseDdMmYyyy('29/02/2024')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });

  it('rejects impossible dates and wrong shapes', () => {
    expect(parseDdMmYyyy('31/02/2026')).toBeNull();
    expect(parseDdMmYyyy('29/02/2026')).toBeNull();
    expect(parseDdMmYyyy('32/01/2026')).toBeNull();
    expect(parseDdMmYyyy('01/13/2026')).toBeNull();
    expect(parseDdMmYyyy('1/10/2026')).toBeNull();
    expect(parseDdMmYyyy('2026-10-01')).toBeNull();
    expect(parseDdMmYyyy('')).toBeNull();
  });
});

describe('isoToDdMmYyyy / ddMmYyyyToIso', () => {
  it('round-trips between ISO storage and DD/MM/YYYY display', () => {
    expect(isoToDdMmYyyy('1998-04-12')).toBe('12/04/1998');
    expect(ddMmYyyyToIso('12/04/1998')).toBe('1998-04-12');
    expect(ddMmYyyyToIso(isoToDdMmYyyy('2026-01-05'))).toBe('2026-01-05');
  });

  it('returns empty/null for anything that is not a real date', () => {
    expect(isoToDdMmYyyy('')).toBe('');
    expect(isoToDdMmYyyy('12/04/1998')).toBe('');
    expect(ddMmYyyyToIso('31/02/2026')).toBeNull();
    expect(ddMmYyyyToIso('1998-04-12')).toBeNull();
    expect(ddMmYyyyToIso('')).toBeNull();
  });
});
