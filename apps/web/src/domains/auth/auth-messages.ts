/**
 * Better Auth error codes turned into the sentence the person should see.
 * Wrong email and wrong password stay the same sentence so a login form
 * does not reveal which of the two was wrong. Every other code says what
 * actually failed.
 */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL: 'Email is not a valid email address.',
  INVALID_EMAIL_OR_PASSWORD: 'Incorrect email or password.',
  INVALID_PASSWORD: 'Incorrect email or password.',
  USER_NOT_FOUND: 'Incorrect email or password.',
  INVALID_USER: 'Incorrect email or password.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'Incorrect email or password.',
  PASSWORD_TOO_SHORT: 'Password must be at least 10 characters, including a letter and a number.',
  PASSWORD_TOO_LONG: 'Password must be at most 128 characters.',
  EMAIL_NOT_VERIFIED: 'Confirm your email before signing in.',
  INVALID_TOKEN: 'This link is invalid or has already been used.',
  TOKEN_EXPIRED: 'This link has expired. Request a new one.',
  SESSION_EXPIRED: 'Your sign-in expired. Enter your password again.',
  INVALID_CODE: 'That code is not correct. Check the time on your phone and try again.',
  INVALID_BACKUP_CODE: 'That backup code is not correct, or it has already been used.',
  INVALID_TWO_FACTOR_COOKIE: 'Your sign-in expired. Enter your password again.',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'Too many incorrect codes. Sign in again to get a new code.',
  ACCOUNT_TEMPORARILY_LOCKED: 'Too many failed attempts. Wait a few minutes and try again.',
  OTP_HAS_EXPIRED: 'That code has expired. Enter the current code from your authenticator app.',
  TOTP_NOT_ENABLED: 'Two-factor authentication is not set up on this account.',
  BACKUP_CODES_NOT_ENABLED: 'Backup codes are not set up on this account.',
  USER_ALREADY_EXISTS: 'An account with this email already exists. Sign in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'An account with this email already exists. Use another email.',
};

/** The sentence for a Better Auth code, or `fallback` when the code is unknown. */
export function betterAuthUserMessage(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  return MESSAGES[code] ?? fallback;
}
