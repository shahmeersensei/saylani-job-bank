import { expect, test } from '@playwright/test';

/** Shared dev credentials — see packages/db/src/seed/dev-data.ts. */
const DEV_PASSWORD = 'JobBank-Dev-2026!';

async function signInAsStaff(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /Staff \/ Admin/ }).click();
  await page.getByLabel(/Email/).fill('staff.lhr@jobbank.local');
  await page.getByLabel(/Password/).fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/staff$/);
}

test.describe('route protection (middleware + role guards)', () => {
  test('anonymous visitors are sent to /login with a next param', async ({ page }) => {
    await page.goto('/staff');
    await expect(page).toHaveURL(/\/login/);
    await expect(page).toHaveURL(/next=/);

    await page.goto('/super-admin');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/applicant');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the login page bounces a signed-in user to their dashboard', async ({ page }) => {
    await signInAsStaff(page);
    await page.goto('/login');
    await expect(page).toHaveURL(/\/staff/);
  });

  test('a signed-in staff member gets /forbidden on another role’s area', async ({ page }) => {
    await signInAsStaff(page);
    await page.goto('/super-admin');
    await expect(page).toHaveURL(/\/forbidden/);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  test('a signed-in staff member can open their own applicants list', async ({ page }) => {
    await signInAsStaff(page);
    await page.goto('/staff/applicants');
    await expect(page.getByRole('heading', { name: 'Applicants' })).toBeVisible();
  });

  test('signing out returns the visitor to the public login page', async ({ page }) => {
    await signInAsStaff(page);
    await page.context().clearCookies();
    await page.goto('/staff');
    await expect(page).toHaveURL(/\/login/);
  });
});
