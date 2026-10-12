import crypto from 'node:crypto';
import Redis from 'ioredis';
import { Client } from 'pg';
import { expect, type Page } from '@playwright/test';

/** Shared dev credentials — see packages/db/src/seed/dev-data.ts. */
export const DEV_PASSWORD = 'JobBank-Dev-2026!';

/**
 * Turns 2FA off for one user (mirrors the dev seed). Suites must start from a clean state:
 * a previous test in the same run may have enrolled an authenticator, and its encrypted
 * secret is not available to the next sign-in.
 */
export async function disableTwoFactor(email: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      'UPDATE users SET two_factor_enabled = false WHERE lower(email) = lower($1)',
      [email],
    );
    await client.query(
      'DELETE FROM two_factors WHERE user_id IN (SELECT id FROM users WHERE lower(email) = lower($1))',
      [email],
    );
  } finally {
    await client.end();
  }
}

/** Clears fixed-window rate-limit counters so repeat logins in one run are not blocked. */
export async function clearRateLimits(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) return;
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 500);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    // Rate limiter may fall back to in-process memory; ignore.
  } finally {
    redis.disconnect();
  }
}

// ─── TOTP (RFC 6238) ─────────────────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Generates a 6-digit TOTP for the given base32 secret (30s period, SHA-1). */
export function generateTotp(base32Secret: string, atMs = Date.now()): string {
  const key = base32Decode(base32Secret);
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff)) %
    1_000_000;
  return code.toString().padStart(6, '0');
}

// ─── Sign-in helpers ─────────────────────────────────────────────────────

/**
 * Signs in with email + password. If the role requires 2FA and none is enrolled
 * (SUPER_ADMIN / BRANCH_ADMIN in the seed), completes the enrollment flow so the
 * user can reach their dashboard.
 */
export async function signInStaff(page: Page, email: string): Promise<void> {
  await Promise.all([clearRateLimits(), disableTwoFactor(email)]);
  await page.goto('/login');
  await page.getByRole('button', { name: /Staff \/ Admin/ }).click();
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  // Force a full server render — the client-side landing URL can sit on the dashboard
  // for seconds before the server's 2FA bounce arrives. The warning banner only renders
  // for roles that require 2FA, so a plain staff user never enrolls.
  await page.goto('/account/security?setup=required');
  const requiredBanner = page.getByText(/requires two-factor authentication/);
  if (await requiredBanner.isVisible().catch(() => false)) {
    await completeTwoFactorEnrollment(page);
  }

  // Land on the user's real home path (the check above hijacked the URL).
  const me = await page.request.get('/api/v1/auth/me');
  const homePath: string | undefined = (await me.json())?.data?.homePath;
  if (homePath) await page.goto(homePath);
}

/** Walks the TwoFactorSetup wizard using the manual key + a locally generated TOTP. */
export async function completeTwoFactorEnrollment(page: Page): Promise<void> {
  // Step 0 — confirm password.
  await page.getByLabel(/Your password/).fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 1 — QR + manual key + backup codes.
  await expect(page.getByText('Save your backup codes')).toBeVisible();
  const manualKey = (await page.locator('code').first().innerText()).trim();
  expect(manualKey).toMatch(/^[A-Z2-7]{16,}$/);
  await page.getByLabel(/I have saved my backup codes/).check();
  // exact: — "Next" also matches the Next.js dev-tools button.
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Step 2 — enter a TOTP code generated from the manual key.
  // OTPInput auto-submits via onComplete when the 6th digit lands, then the page
  // replaces to the user's home path — wait for that navigation.
  const code = generateTotp(manualKey);
  const firstDigit = page.getByLabel(/Digit 1 of 6/);
  await firstDigit.click();
  await firstDigit.pressSequentially(code, { delay: 30 });
  await expect(page).not.toHaveURL(/account\/security/, { timeout: 20_000 });

  // Required roles are redirected to their home path after enrollment.
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page).not.toHaveURL(/setup=required/);
}
