import * as z from 'zod';
import { fieldLabel } from './field-label';

/**
 * Global Zod error map. A check that already has its own message wins
 * (Zod only calls this when no message was given), so existing copy stays.
 * Every sentence names the field and the exact rule that failed.
 */
export function zodIssueMessage(issue: {
  code?: string;
  path?: readonly PropertyKey[];
  expected?: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  exact?: boolean;
  format?: string;
  values?: readonly unknown[];
  keys?: readonly string[];
  divisor?: number;
  input?: unknown;
  prefix?: string;
  suffix?: string;
  includes?: string;
}): string {
  const label = fieldLabel(issue.path ?? []);
  const say = (rest: string) => (label === 'Form' ? capitalize(rest) : `${label} ${rest}`);

  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined || issue.input === null) return say('is required.');
      return say(typePhrase(issue.expected));
    }
    case 'too_small':
      return say(sizePhrase('small', issue.origin, issue.minimum, issue.inclusive, issue.exact));
    case 'too_big':
      return say(sizePhrase('big', issue.origin, issue.maximum, issue.inclusive, issue.exact));
    case 'invalid_value':
      return say(oneOf(issue.values ?? []));
    case 'invalid_format':
      return say(formatPhrase(issue.format, issue));
    case 'not_multiple_of':
      return say(`must be a multiple of ${issue.divisor ?? 'the required step'}.`);
    case 'unrecognized_keys': {
      const keys = (issue.keys ?? []).slice(0, 5).join(', ');
      return keys
        ? `Unexpected ${(issue.keys ?? []).length === 1 ? 'field' : 'fields'}: ${keys}.`
        : 'Unexpected field.';
    }
    case 'invalid_union':
      return say('does not match an accepted option.');
    case 'invalid_key':
      return say('has a key that is not allowed.');
    case 'invalid_element':
      return say('has a value that is not allowed.');
    default:
      return say('is not valid.');
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function typePhrase(expected: string | undefined): string {
  switch (expected) {
    case 'string':
      return 'must be text.';
    case 'number':
      return 'must be a number.';
    case 'int':
      return 'must be a whole number.';
    case 'boolean':
      return 'must be yes or no.';
    case 'date':
      return 'must be a date.';
    case 'array':
      return 'must be a list.';
    case 'object':
      return 'must be a set of fields.';
    case 'file':
      return 'must be a file.';
    default:
      return `must be a ${expected ?? 'valid value'}.`;
  }
}

function sizePhrase(
  direction: 'small' | 'big',
  origin: string | undefined,
  bound: number | bigint | undefined,
  inclusive: boolean | undefined,
  exact: boolean | undefined,
): string {
  const n = bound ?? 0;
  const sized = origin === 'string' || origin === 'array' || origin === 'set' || origin === 'file';
  if (exact && sized) return `must be exactly ${count(n, unit(origin))}.`;
  if (direction === 'small') {
    if (origin === 'date')
      return inclusive === false ? `must be after ${when(n)}.` : `must be on or after ${when(n)}.`;
    if (sized) return `must be at least ${count(n, unit(origin))}.`;
    return inclusive === false ? `must be greater than ${n}.` : `must be at least ${n}.`;
  }
  if (origin === 'date')
    return inclusive === false ? `must be before ${when(n)}.` : `must be on or before ${when(n)}.`;
  if (sized) return `must be at most ${count(n, unit(origin))}.`;
  return inclusive === false ? `must be less than ${n}.` : `must be at most ${n}.`;
}

function unit(origin: string | undefined): string {
  if (origin === 'string') return 'character';
  if (origin === 'file') return 'byte';
  return 'item';
}

function count(n: number | bigint, singular: string): string {
  const many = typeof n === 'bigint' ? n !== 1n : n !== 1;
  return `${n} ${many ? `${singular}s` : singular}`;
}

function when(value: number | bigint): string {
  const n = typeof value === 'bigint' ? Number(value) : value;
  if (Number.isFinite(n) && Math.abs(n) > 1e11) return new Date(n).toISOString().slice(0, 10);
  return String(value);
}

function oneOf(values: readonly unknown[]): string {
  const shown = values.slice(0, 8).map((value) => String(value));
  if (shown.length === 0) return 'is not an allowed value.';
  if (values.length > shown.length) return `must be one of: ${shown.join(', ')}, …`;
  return `must be one of: ${shown.join(', ')}.`;
}

function formatPhrase(
  format: string | undefined,
  issue: { prefix?: string; suffix?: string; includes?: string },
): string {
  switch (format) {
    case 'email':
      return 'is not a valid email.';
    case 'url':
      return 'is not a valid URL.';
    case 'uuid':
    case 'uuidv4':
    case 'guid':
      return 'is not a valid id.';
    case 'date':
    case 'datetime':
    case 'time':
      return 'is not a valid date.';
    case 'regex':
      return 'is not in the right format.';
    case 'starts_with':
      return `must start with "${issue.prefix ?? ''}".`;
    case 'ends_with':
      return `must end with "${issue.suffix ?? ''}".`;
    case 'includes':
      return `must include "${issue.includes ?? ''}".`;
    case 'e164':
      return 'is not a valid phone number.';
    default:
      return format
        ? `is not a valid ${format.replace(/_/g, ' ')}.`
        : 'is not in the right format.';
  }
}

/** Installs the map for every later parse in this process. Custom messages are left alone. */
export function installZodErrorMap(): void {
  z.config({
    customError: (issue) => zodIssueMessage(issue),
  });
}

installZodErrorMap();
