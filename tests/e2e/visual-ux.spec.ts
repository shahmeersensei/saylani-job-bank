import { expect, test } from '@playwright/test';

/**
 * Visual regression (screenshot) tests for key public pages.
 *
 * Run:   pnpm test:visual-verify          (compare against committed baselines)
 * Update: pnpm test:visual-update         (regenerate baselines after an intended UI change)
 *
 * Baselines live in tests/e2e/visual-ux.spec.ts-snapshots/ and are committed.
 * Each page is captured at a fixed viewport so screenshots are stable across runs.
 */

// Public pages that must stay visually stable. Detail/dashboard pages are covered by
// the functional suites; visual regression focuses on the highest-traffic public surface.
const PAGES = [
  { name: 'landing', url: '/' },
  { name: 'login', url: '/login' },
  { name: 'register', url: '/register' },
  { name: 'forgot-password', url: '/forgot-password' },
  { name: 'forbidden', url: '/forbidden' },
] as const;

test.describe('visual regression — public pages', () => {
  for (const { name, url } of PAGES) {
    test(`${name} matches baseline`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(url, { waitUntil: 'networkidle' });

      // Mask anything that changes run-to-run (clocks, correlation ids, random copy).
      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        // Small tolerance absorbs anti-aliasing differences across minor font-render changes.
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});
