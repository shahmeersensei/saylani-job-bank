import { expect, test } from '@playwright/test';

/**
 * Cross-browser smoke: a small set of critical flows that must work in Chromium,
 * Firefox AND WebKit (Safari engine). Kept deliberately tiny so the suite stays fast —
 * the full functional coverage lives in the other specs (chromium-only).
 *
 * Run: pnpm test:cross-browser
 */

test.describe('cross-browser smoke', () => {
  test('landing page renders in this browser', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('login page renders and role cards are present', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Choose your role to continue:')).toBeVisible();
    await expect(page.getByRole('button', { name: /Job Seeker/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Employer/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Staff \/ Admin/ })).toBeVisible();
  });

  test('protected route redirects anonymous to login', async ({ page }) => {
    await page.goto('/staff');
    await expect(page).toHaveURL(/\/login/);
  });

  test('staff can sign in and land on the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /Staff \/ Admin/ }).click();
    await page.getByLabel(/Email/).fill('staff.khi@jobbank.local');
    await page.getByLabel(/Password/).fill('JobBank-Dev-2026!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page).toHaveURL(/\/staff$/);
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  });
});
