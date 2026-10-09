import { expect, test } from '@playwright/test';

/**
 * Coverage for the pages no other spec reaches: the applicant area, every detail (`[id]`)
 * route, and the remaining super-admin screens.
 *
 * Detail routes are visited with a syntactically valid but non-existent id — the contract is
 * "never 5xx, always a real page state" (content, a not-found state, or a role bounce), which
 * is what a broken query/param binding violates.
 */

const DEV_PASSWORD = 'JobBank-Dev-2026!';
const MISSING_UUID = '00000000-0000-0000-0000-000000000000';

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: /Staff \/ Admin/ }).click();
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

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
    const landed = page.url();
    // A role bounce or a not-found page is an acceptable outcome; a blank shell is not.
    if (landed.includes('/login') || landed.includes('/forbidden')) continue;
    await expect(
      page.locator('h1, [role="status"], [data-testid="empty-state"]').first(),
      `${label} ${url} must render a page state`,
    ).toBeAttached();
  }
}

test.describe('applicant area', () => {
  test('/applicant, /applicant/profile, /applicant/documents', async ({ page }) => {
    await sweep(page, 'staff.khi@jobbank.local', ['/staff'], 'warm');
    // The applicant area is owned by the phone-signed-in applicant; staff may be bounced.
    for (const url of ['/applicant', '/applicant/profile', '/applicant/documents']) {
      const response = await page.goto(url);
      expect(response?.status(), `applicant ${url} status`).toBeLessThan(500);
    }
  });
});

test.describe('detail routes never 5xx', () => {
  test('staff detail pages', async ({ page }) => {
    await sweep(page, 'staff.khi@jobbank.local', [
      `/staff/applicants/${MISSING_UUID}`,
    ], 'staff');
  });

  test('super admin detail pages', async ({ page }) => {
    await sweep(page, 'superadmin@jobbank.local', [
      '/super-admin/applicants',
      `/super-admin/applicants/${MISSING_UUID}`,
      `/super-admin/branches/${MISSING_UUID}`,
      `/super-admin/companies/${MISSING_UUID}`,
      `/super-admin/jobs/${MISSING_UUID}`,
      `/super-admin/staff/${MISSING_UUID}`,
    ], 'super-admin');
  });

  test('employer detail pages', async ({ page }) => {
    await sweep(page, 'employer@jobbank.local', [
      `/employer/jobs/${MISSING_UUID}`,
      `/employer/jobs/${MISSING_UUID}/edit`,
    ], 'employer');
  });

  test('branch-admin area', async ({ page }) => {
    await sweep(page, 'superadmin@jobbank.local', [
      '/branch-admin',
      '/branch-admin/applicants',
      `/branch-admin/applicants/${MISSING_UUID}`,
      '/branch-admin/companies',
      '/branch-admin/companies/new',
      `/branch-admin/companies/${MISSING_UUID}`,
      '/branch-admin/jobs',
      '/branch-admin/jobs/new',
      `/branch-admin/jobs/${MISSING_UUID}`,
      '/branch-admin/settings',
      '/branch-admin/staff',
      `/branch-admin/staff/${MISSING_UUID}`,
    ], 'branch-admin');
  });

  test('verifier detail page', async ({ page }) => {
    await sweep(page, 'verifier.khi@jobbank.local', [
      `/verifier/queue/${MISSING_UUID}`,
    ], 'verifier');
  });
});
