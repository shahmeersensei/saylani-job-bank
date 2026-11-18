import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch: apiFetchMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('TopBar account menu', () => {
  beforeEach(() => {
    apiFetchMock.mockResolvedValue({ data: [], meta: { unread: 0 } });
  });

  it('uses a stable trigger ID and labels the menu from that trigger', async () => {
    const user = userEvent.setup();
    render(
      <TopBar
        user={{ name: 'Ayesha Verifier', role: 'Verification Officer' }}
        userMenuItems={[{ label: 'Sign out', onSelect: vi.fn() }]}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Account menu for Ayesha Verifier' });
    expect(trigger).toHaveAttribute('id', 'account-menu-trigger');

    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveAttribute('aria-labelledby', 'account-menu-trigger');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
  });
});
