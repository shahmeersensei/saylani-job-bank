import { expect, test } from '@playwright/test';

/** Shared dev credentials — see packages/db/src/seed/dev-data.ts. */
const DEV_PASSWORD = 'JobBank-Dev-2026!';

/** A PK mobile number in national format (never verified, so a random one is safe). */
const randomPhone = () =>
  `300${Math.floor(Math.random() * 1e7)
    .toString()
    .padStart(7, '0')}`;

test.describe('login page', () => {
  test('shows the three role cards first', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Choose your role to continue:')).toBeVisible();
    await expect(page.getByRole('button', { name: /Job Seeker/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Employer/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Staff \/ Admin/ })).toBeVisible();
  });

  test('staff signs in with email + password and lands on the staff dashboard', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /Staff \/ Admin/ }).click();
    await page.getByLabel(/Email/).fill('staff.khi@jobbank.local');
    await page.getByLabel(/Password/).fill(DEV_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page).toHaveURL(/\/staff$/);
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  });

  test('wrong password shows an inline error', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /Staff \/ Admin/ }).click();
    await page.getByLabel(/Email/).fill(`nobody-${Date.now()}@example.com`);
    await page.getByLabel(/Password/).fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByText('Incorrect email or password')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('job seeker requests an SMS code and reaches the code step', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /Job Seeker/ }).click();
    await expect(page.getByText('Mobile number')).toBeVisible();
    await page.getByLabel(/Mobile number/).fill(randomPhone());
    await page.getByRole('button', { name: 'Send code' }).click();

    await expect(page.getByText(/Enter the 6-digit code sent to/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify and continue' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  });

  test('employer can switch to the emailed sign-in code form', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /^Employer/ }).click();
    await page.getByRole('button', { name: /Email me a sign-in code instead/ }).click();

    await expect(page.getByText(/Employers can sign in with a one-time code/)).toBeVisible();
    await expect(page.getByLabel(/Work email/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Email me a code' })).toBeVisible();
  });

  test('forgot-password page renders its form', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByText('Reset your password')).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to sign in/ })).toBeVisible();
  });
});

test.describe('super admin first sign-in', () => {
  test('lands on the super-admin dashboard and can open the 2FA setup page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /Staff \/ Admin/ }).click();
    await page.getByLabel(/Email/).fill('superadmin@jobbank.local');
    await page.getByLabel(/Password/).fill(DEV_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // The Super Admin is signed in but has no authenticator enrolled yet, so the
    // security page offers the two-factor setup.
    await expect(page).toHaveURL(/\/super-admin/);
    await page.goto('/account/security?setup=required');
    await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
    await expect(page.getByText(/You will need an authenticator app/)).toBeVisible();
  });
});
