import { locale } from '@/design-system/tokens';

/*
 * Every date is formatted in a fixed zone (Asia/Karachi) so server-rendered and
 * client-rendered text match exactly (no hydration mismatch) and users see local time.
 *
 * Display standard (2026-11-14): DD/MM/YYYY, zero-padded, 12-hour time
 * ("01/10/2026", "01/10/2026, 5:30 pm"). Values stay ISO everywhere else —
 * the database, the API and <input type="date"> all keep YYYY-MM-DD.
 */

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: locale.timeZone,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

function parts(value: Date | string) {
  const found: Record<string, string> = {};
  for (const part of partsFormat.formatToParts(toDate(value))) {
    if (part.type !== 'literal') found[part.type] = part.value;
  }
  return found;
}

/** "01/10/2026" */
export function formatDate(value: Date | string): string {
  const { day, month, year } = parts(value);
  return `${day}/${month}/${year}`;
}

/** ISO "2026-10-01" (or "") -> display "01/10/2026" (or ""). */
export function isoToDdMmYyyy(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Display "DD/MM/YYYY" -> ISO "YYYY-MM-DD" (the storage format), or null
 * when the text is not a real calendar date. Thin wrapper over parseDdMmYyyy.
 */
export function ddMmYyyyToIso(value: string): string | null {
  const date = parseDdMmYyyy(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

/** "5:30 pm" */
export function formatTime(value: Date | string): string {
  const { hour, minute, dayPeriod } = parts(value);
  return `${hour}:${minute} ${dayPeriod}`;
}

/** "01/10/2026, 5:30 pm" */
export function formatDateTime(value: Date | string): string {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

/** ISO string for <time dateTime>. */
export function toIso(value: Date | string): string {
  return toDate(value).toISOString();
}

const DD_MM_YYYY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/**
 * Strictly parse "DD/MM/YYYY" into a UTC-midnight Date, or null when the
 * text is not a real calendar date (31/02/2026, 32/01/2026, wrong shape).
 * Date-only values in this codebase are UTC midnights ("2026-10-01"), so
 * the result round-trips through ISO storage.
 */
export function parseDdMmYyyy(value: string): Date | null {
  const match = DD_MM_YYYY.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}
