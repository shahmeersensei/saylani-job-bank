import { expect, test } from '@playwright/test';

test.describe('landing page', () => {
  test('renders the hero, badge and brand title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Saylani Job Bank/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Opportunity');
    await expect(page.getByText("Pakistan's #1 Free Job Platform")).toBeVisible();
  });

  test('the header "Log In" link opens the login page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Log In' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByText('Choose your role to continue:')).toBeVisible();
  });

  test('the "Sign Up" link opens the employer register page', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('link', { name: /sign up/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByText('Register as an employer')).toBeVisible();
  });
});
