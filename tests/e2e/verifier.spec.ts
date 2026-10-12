import { expect, test } from '@playwright/test';
import { signInStaff } from './helpers';

/** Seeded Verification Officer (Karachi — Gulshan-e-Iqbal). */
const VERIFIER_EMAIL = 'verifier.khi@jobbank.local';
/** Seeded Job Bank Staff — the lower-privilege role used for the isolation case. */
const STAFF_EMAIL = 'staff.khi@jobbank.local';

test.describe('verifier area (/verifier)', () => {
  test('sign-in lands on the verifier dashboard', async ({ page }) => {
    await signInStaff(page, VERIFIER_EMAIL);

    await expect(page).toHaveURL(/\/verifier$/);
    await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible();
  });

  test('the verification queue renders', async ({ page }) => {
    await signInStaff(page, VERIFIER_EMAIL);

    await page.goto('/verifier/queue');
    await expect(page).toHaveURL(/\/verifier\/queue$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Verification Queue' })).toBeVisible();
  });

  test('signing out returns the verifier to the login page', async ({ page }) => {
    await signInStaff(page, VERIFIER_EMAIL);

    await page.getByRole('button', { name: /Account menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Choose your role to continue:')).toBeVisible();
  });

  test('a staff member is refused the verifier area', async ({ page }) => {
    await signInStaff(page, STAFF_EMAIL);
    await expect(page).toHaveURL(/\/staff$/);

    await page.goto('/verifier');
    await expect(page).toHaveURL(/\/forbidden/);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});
