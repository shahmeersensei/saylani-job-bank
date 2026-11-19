import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch: apiFetchMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('NotificationBell', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('uses the server unread count, including notifications outside the first page', async () => {
    apiFetchMock.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 8, total: 20, pageCount: 3, unread: 2 },
    });
    render(<NotificationBell />);
    const trigger = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    expect(trigger).toHaveAttribute('id', 'notification-menu-trigger');
    expect(trigger).toBeVisible();

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveAttribute('aria-labelledby', 'notification-menu-trigger');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
  });

  it('shows a loading error rather than an empty success state', async () => {
    apiFetchMock.mockRejectedValue(new Error('Network error'));
    render(<NotificationBell />);
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load'));
    expect(screen.queryByText('No notifications yet.')).not.toBeInTheDocument();
  });
});
