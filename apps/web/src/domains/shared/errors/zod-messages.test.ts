import '@jobbank/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('zod error map', () => {
  it('names the field and the rule when the schema has no custom message', () => {
    const missing = z.object({ fullName: z.string() }).safeParse({});
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues[0]?.message).toBe('Full name is required.');
    }

    const short = z.object({ fullName: z.string().min(2) }).safeParse({ fullName: 'A' });
    expect(short.success).toBe(false);
    if (!short.success) {
      expect(short.error.issues[0]?.message).toBe('Full name must be at least 2 characters.');
    }

    const long = z.object({ note: z.string().max(3) }).safeParse({ note: 'abcd' });
    expect(long.success).toBe(false);
    if (!long.success)
      expect(long.error.issues[0]?.message).toBe('Note must be at most 3 characters.');

    const number = z.object({ age: z.number() }).safeParse({ age: '12' });
    expect(number.success).toBe(false);
    if (!number.success) expect(number.error.issues[0]?.message).toBe('Age must be a number.');

    const choice = z.object({ gender: z.enum(['MALE', 'FEMALE']) }).safeParse({ gender: 'OTHER' });
    expect(choice.success).toBe(false);
    if (!choice.success) {
      expect(choice.error.issues[0]?.message).toBe('Gender must be one of: MALE, FEMALE.');
    }

    const email = z.object({ email: z.email() }).safeParse({ email: 'not-an-email' });
    expect(email.success).toBe(false);
    if (!email.success) expect(email.error.issues[0]?.message).toBe('Email is not a valid email.');
  });

  it('leaves a custom message untouched', () => {
    const parsed = z.object({ fullName: z.string().min(2, 'Enter your name') }).safeParse({
      fullName: '',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe('Enter your name');
  });
});
