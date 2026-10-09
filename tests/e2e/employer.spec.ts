import { expect, test } from '@playwright/test';

/** Shared dev credentials — see packages/db/src/seed/dev-data.ts. */
const DEV_PASSWORD = 'JobBank-Dev-2026!';

/** Seeded employer (no company row yet, so /employer/company shows the registration wizard). */
const EMPLOYER_EMAIL = 'employer@jobbank.local';
/** Seeded Job Bank Staff — the lower-privilege role used for the isolation case. */
const STAFF_EMAIL = 'staff.khi@jobbank.local';

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: /Staff \/ Admin/ }).click();
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('employer area (/employer)', () => {
  test('sign-in lands on the employer dashboard', async ({ page }) => {
    await signIn(page, EMPLOYER_EMAIL);

    await expect(page).toHaveURL(/\/employer$/);
    await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible();
  });

  test('the company registration page renders its wizard', async ({ page }) => {
    await signIn(page, EMPLOYER_EMAIL);

    await page.goto('/employer/company');
    await expect(page).toHaveURL(/\/employer\/company$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Register your company' }),
    ).toBeVisible();
  });

  test('the jobs list and the job posting form render', async ({ page }) => {
    await signIn(page, EMPLOYER_EMAIL);

    await page.goto('/employer/jobs');
    await expect(page).toHaveURL(/\/employer\/jobs$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My jobs' })).toBeVisible();

    await page.goto('/employer/jobs/new');
    await expect(page).toHaveURL(/\/employer\/jobs\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Post a new job' })).toBeVisible();
  });

  test('signing out returns the employer to the login page', async ({ page }) => {
    await signIn(page, EMPLOYER_EMAIL);

    await page.getByRole('button', { name: /Account menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Choose your role to continue:')).toBeVisible();
  });

  test('a staff member is refused the employer area', async ({ page }) => {
    await signIn(page, STAFF_EMAIL);
    await expect(page).toHaveURL(/\/staff$/);

    await page.goto('/employer');
    await expect(page).toHaveURL(/\/forbidden/);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});
