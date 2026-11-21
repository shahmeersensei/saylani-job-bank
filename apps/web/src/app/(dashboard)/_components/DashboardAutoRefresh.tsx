'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Dashboards are force-dynamic server components: fresh on every load
 * and navigation, but static while you look at them — nothing in the
 * project pushes updates to the browser. This re-runs the server data
 * on an interval, but only while the tab is visible, and whenever the
 * tab regains focus, so the counts move without a manual refresh.
 *
 * No websocket / SSE exists in the project, and interview counts change
 * a few times a day, so polling is the right weight here: a 30s refresh
 * of one dashboard's queries is trivial load, and the interval pauses
 * itself on a hidden tab. The manual "Refresh data" card menu stays as
 * the instant option. Client state (e.g. the chart's period tab) is
 * preserved across a router.refresh(), so this never resets what the
 * user is looking at.
 */
export function DashboardAutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const id = window.setInterval(refreshIfVisible, intervalMs);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [router, intervalMs]);
  return null;
}
