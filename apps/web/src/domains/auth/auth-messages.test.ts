import { describe, expect, it } from 'vitest';
import { betterAuthUserMessage } from './auth-messages';

describe('betterAuthUserMessage', () => {
  it('keeps a wrong password and a missing account on the same sentence', () => {
    expect(betterAuthUserMessage('INVALID_EMAIL_OR_PASSWORD', 'fallback')).toBe(
      'Incorrect email or password.',
    );
    expect(betterAuthUserMessage('USER_NOT_FOUND', 'fallback')).toBe(
      'Incorrect email or password.',
    );
  });

  it('names the specific failure for a code, a backup code, and an expired link', () => {
    expect(betterAuthUserMessage('INVALID_BACKUP_CODE', 'fallback')).toContain('backup code');
    expect(betterAuthUserMessage('TOKEN_EXPIRED', 'fallback')).toContain('expired');
    expect(betterAuthUserMessage('PASSWORD_TOO_SHORT', 'fallback')).toContain('10 characters');
    expect(betterAuthUserMessage('SOMETHING_ELSE', 'Try again.')).toBe('Try again.');
  });
});
