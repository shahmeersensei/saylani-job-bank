import { expect, test } from '@playwright/test';
import { signInStaff } from './helpers';

/** Seeded Branch Admin for the Karachi — Gulshan-e-Iqbal branch. */
const BRANCH_ADMIN_EMAIL = 'branchadmin.khi@jobbank.local';
/** Seeded Job Bank Staff — the lower-privilege role used for the isolation case. */
const STAFF_EMAIL = 'staff.khi@jobbank.local';

test.describe('branch admin area (/branch-admin)', () => {
  test('the dashboard renders the welcome panel', async ({ page }) => {
    await signInStaff(page, BRANCH_ADMIN_EMAIL);

    await page.goto('/branch-admin');
    await expect(page).toHaveURL(/\/branch-admin$/);
    await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible();
  });

  test('the applicants, companies and add-company pages render', async ({ page }) => {
    await signInStaff(page, BRANCH_ADMIN_EMAIL);

    await page.goto('/branch-admin/applicants');
    await expect(page).toHaveURL(/\/branch-admin\/applicants$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Applicants' })).toBeVisible();

    await page.goto('/branch-admin/companies');
    await expect(page).toHaveURL(/\/branch-admin\/companies$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Companies' })).toBeVisible();

    await page.goto('/branch-admin/companies/new');
    await expect(page).toHaveURL(/\/branch-admin\/companies\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Add company' })).toBeVisible();
  });

  test('the jobs, post-a-job, settings and staff pages render', async ({ page }) => {
    await signInStaff(page, BRANCH_ADMIN_EMAIL);

    await page.goto('/branch-admin/jobs');
    await expect(page).toHaveURL(/\/branch-admin\/jobs$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();

    await page.goto('/branch-admin/jobs/new');
    await expect(page).toHaveURL(/\/branch-admin\/jobs\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Post a job' })).toBeVisible();

    await page.goto('/branch-admin/settings');
    await expect(page).toHaveURL(/\/branch-admin\/settings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Branch settings' })).toBeVisible();

    await page.goto('/branch-admin/staff');
    await expect(page).toHaveURL(/\/branch-admin\/staff$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
  });

  test('signing out returns the admin to the login page', async ({ page }) => {
    await signInStaff(page, BRANCH_ADMIN_EMAIL);

    await page.getByRole('button', { name: /Account menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Choose your role to continue:')).toBeVisible();
  });

  test('a staff member is refused the branch admin area', async ({ page }) => {
    await signInStaff(page, STAFF_EMAIL);
    await expect(page).toHaveURL(/\/staff$/);

    await page.goto('/branch-admin');
    await expect(page).toHaveURL(/\/forbidden/);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});
