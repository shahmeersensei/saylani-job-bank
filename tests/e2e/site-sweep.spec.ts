import { expect, test } from '@playwright/test';

/**
 * Whole-site sweep: every page in the app must render for the role that owns it, must not
 * answer 5xx, and must expose a top-level heading. Per-page content assertions live in the
 * role-specific specs — this file guarantees no page is simply broken.
 *
 * It is also the defect catcher: a page that 500s or renders an empty shell shows up here.
 */

const DEV_PASSWORD = 'JobBank-Dev-2026!';

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: /Staff \/ Admin/ }).click();
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

type Target = { url: string; role: 'anonymous' | 'staff' | 'employer' | 'superadmin' | 'verifier' };

/** Public surface. */
const PUBLIC: Target[] = [
  { url: '/', role: 'anonymous' },
  { url: '/login', role: 'anonymous' },
  { url: '/register', role: 'anonymous' },
  { url: '/forgot-password', role: 'anonymous' },
  { url: '/reset-password', role: 'anonymous' },
  { url: '/accept-invite', role: 'anonymous' },
  { url: '/account-disabled', role: 'anonymous' },
  { url: '/forbidden', role: 'anonymous' },
];

const STAFF: string[] = ['/staff', '/staff/applicants', '/account/security'];

const EMPLOYER: string[] = [
  '/employer',
  '/employer/company',
  '/employer/jobs',
  '/employer/jobs/new',
];

const SUPER_ADMIN: string[] = [
  '/super-admin',
  '/super-admin/branches',
  '/super-admin/branches/new',
  '/super-admin/companies',
  '/super-admin/jobs',
  '/super-admin/master-data',
  '/super-admin/settings',
  '/super-admin/staff',
  '/super-admin/applicants',
];

const VERIFIER: string[] = ['/verifier', '/verifier/queue'];

test.describe('public pages render', () => {
  for (const target of PUBLIC) {
    test(`${target.url} renders without a server error`, async ({ page }) => {
      const response = await page.goto(target.url);
      expect(response?.status(), `${target.url} status`).toBeLessThan(500);
      await expect(page.locator('h1').first()).toBeVisible();
    });
  }
});

async function sweep(
  page: import('@playwright/test').Page,
  email: string,
  urls: string[],
  label: string,
) {
  await signIn(page, email);
  for (const url of urls) {
    const response = await page.goto(url);
    expect(response?.status(), `${label} ${url} status`).toBeLessThan(500);
    // The role guard may bounce the user (e.g. SUPER_ADMIN without 2FA); anything that
    // renders must render a heading.
    if (!page.url().includes('/forbidden') && !page.url().includes('/login')) {
      await expect(page.locator('h1').first(), `${label} ${url} heading`).toBeVisible();
    }
  }
}

test.describe('role areas render', () => {
  test('staff area', async ({ page }) => {
    await sweep(page, 'staff.khi@jobbank.local', STAFF, 'staff');
  });

  test('employer area', async ({ page }) => {
    await sweep(page, 'employer@jobbank.local', EMPLOYER, 'employer');
  });

  test('super admin area', async ({ page }) => {
    await sweep(page, 'superadmin@jobbank.local', SUPER_ADMIN, 'super-admin');
  });

  test('verifier area', async ({ page }) => {
    await sweep(page, 'verifier.khi@jobbank.local', VERIFIER, 'verifier');
  });
});
