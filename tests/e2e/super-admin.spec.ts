import { expect, test } from '@playwright/test';
import { signInStaff } from './helpers';

/** Seeded Super Admin (2FA not enrolled). */
const SUPER_ADMIN_EMAIL = 'superadmin@jobbank.local';
/** Seeded Job Bank Staff — the lower-privilege role used for the isolation case. */
const STAFF_EMAIL = 'staff.lhr@jobbank.local';

test.describe('super admin area (/super-admin)', () => {
  test('the dashboard, branches list and new-branch form render', async ({ page }) => {
    await signInStaff(page, SUPER_ADMIN_EMAIL);

    await page.goto('/super-admin');
    await expect(page).toHaveURL(/\/super-admin$/);
    await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible();

    await page.goto('/super-admin/branches');
    await expect(page).toHaveURL(/\/super-admin\/branches$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Branches' })).toBeVisible();

    await page.goto('/super-admin/branches/new');
    await expect(page).toHaveURL(/\/super-admin\/branches\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: 'New branch' })).toBeVisible();
  });

  test('the companies, jobs and master-data pages render', async ({ page }) => {
    await signInStaff(page, SUPER_ADMIN_EMAIL);

    await page.goto('/super-admin/companies');
    await expect(page).toHaveURL(/\/super-admin\/companies$/);
    await expect(page.getByRole('heading', { level: 1, name: 'All companies' })).toBeVisible();

    await page.goto('/super-admin/jobs');
    await expect(page).toHaveURL(/\/super-admin\/jobs$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();

    await page.goto('/super-admin/master-data');
    await expect(page).toHaveURL(/\/super-admin\/master-data$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Master data' })).toBeVisible();
  });

  test('the settings and staff pages render', async ({ page }) => {
    await signInStaff(page, SUPER_ADMIN_EMAIL);

    await page.goto('/super-admin/settings');
    await expect(page).toHaveURL(/\/super-admin\/settings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    await page.goto('/super-admin/staff');
    await expect(page).toHaveURL(/\/super-admin\/staff$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
  });

  test('signing out returns the admin to the login page', async ({ page }) => {
    await signInStaff(page, SUPER_ADMIN_EMAIL);

    await page.getByRole('button', { name: /Account menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Choose your role to continue:')).toBeVisible();
  });

  test('a staff member is refused the super admin area', async ({ page }) => {
    await signInStaff(page, STAFF_EMAIL);
    await expect(page).toHaveURL(/\/staff$/);

    await page.goto('/super-admin');
    await expect(page).toHaveURL(/\/forbidden/);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});
