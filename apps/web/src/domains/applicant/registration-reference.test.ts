import { describe, expect, it } from 'vitest';
import {
  createRegistrationReference,
  REGISTRATION_REFERENCE_ALPHABET,
  REGISTRATION_REFERENCE_LENGTH,
} from './registration-reference';

const LOOKALIKES = ['0', 'O', '1', 'I', 'L'] as const;

describe('createRegistrationReference', () => {
  it('is 8 characters from the alphabet, with no look-alike glyphs', () => {
    expect(REGISTRATION_REFERENCE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    expect(REGISTRATION_REFERENCE_LENGTH).toBe(8);
    for (const bad of LOOKALIKES) {
      expect(REGISTRATION_REFERENCE_ALPHABET).not.toContain(bad);
    }

    const seen = new Set<string>();
    for (let sample = 0; sample < 200; sample++) {
      const reference = createRegistrationReference();
      expect(reference).toHaveLength(8);
      expect(reference).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
      for (const bad of LOOKALIKES) expect(reference).not.toContain(bad);
      seen.add(reference);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
