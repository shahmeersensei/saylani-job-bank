import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClientModule from '@/lib/api/client';
import { RegisterCompanyDialog } from './RegisterCompanyDialog';

const { apiFetchMock, refreshMock, replaceMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/verifier',
  useRouter: () => ({ refresh: refreshMock, replace: replaceMock }),
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, apiFetch: apiFetchMock };
});

describe('RegisterCompanyDialog', () => {
  beforeEach(() => {
    apiFetchMock.mockReset().mockResolvedValue({
      data: [{ id: 'industry-id', code: 'MANUFACTURING', label: 'Manufacturing', parentId: null }],
    });
    refreshMock.mockReset();
    replaceMock.mockReset();
  });

  it('does not save just because the user reaches the final step', async () => {
    const user = userEvent.setup();
    render(
      <RegisterCompanyDialog
        branches={[{ value: '00000000-0000-4000-8000-000000000001', label: 'Karachi branch' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Register Company' }));
    await screen.findByRole('option', { name: 'Manufacturing' });
    await user.type(screen.getByPlaceholderText('Registered company name'), 'Example Company');

    for (const label of [/Legal structure/, /Company size/, /Industry/]) {
      const select = screen.getByRole('combobox', { name: label }) as HTMLSelectElement;
      await user.selectOptions(select, select.options[1]!.value);
    }

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByPlaceholderText('Full name of the person you met'), 'Test Contact');
    await user.type(screen.getByPlaceholderText('0300 1234567 or 021 34567890'), '03001234567');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const saveButton = screen.getByRole('button', { name: 'Save company' });
    expect(saveButton).toHaveAttribute('type', 'button');

    fireEvent.submit(document.querySelector('form')!);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).not.toHaveBeenCalledWith('/api/v1/companies/onboard', expect.anything());
  }, 15_000);
});
