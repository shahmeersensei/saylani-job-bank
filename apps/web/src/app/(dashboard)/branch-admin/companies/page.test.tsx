import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BranchAdminCompaniesPage from './page';

const { listCompanies } = vi.hoisted(() => ({ listCompanies: vi.fn() }));
vi.mock('@/domains/auth', () => ({
  requireRole: async () => ({ actor: { permissions: new Set<string>() } }),
}));
vi.mock('@/domains/company', async () => {
  const { z } = await import('zod');
  return {
    COMPANY_SORTABLE: ['legalName', 'createdAt', 'status'],
    companyFilters: { status: z.string().optional(), branchId: z.uuid().optional() },
    listCompanies,
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

describe('Branch Admin company status filter', () => {
  it('passes Info needed to the server-side list and displays the selected option', async () => {
    listCompanies.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 20, pageCount: 0, total: 0 },
    });
    const page = await BranchAdminCompaniesPage({
      searchParams: Promise.resolve({ status: 'INFO_REQUESTED', q: 'example' }),
    });
    render(page);
    expect(screen.getByLabelText('Status')).toHaveValue('INFO_REQUESTED');
    expect(screen.getByRole('option', { name: 'Info needed' })).toHaveValue('INFO_REQUESTED');
    expect(listCompanies).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ q: 'example', filters: { status: 'INFO_REQUESTED' } }),
    );
  });

  it('lets the Branch Admin filter for companies returned by a verifier', async () => {
    listCompanies.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 20, pageCount: 0, total: 0 },
    });
    const page = await BranchAdminCompaniesPage({
      searchParams: Promise.resolve({ status: 'RESUBMITTED' }),
    });
    render(page);
    expect(screen.getByLabelText('Status')).toHaveValue('RESUBMITTED');
    expect(screen.getByRole('option', { name: 'Resubmitted — ready for review' })).toHaveValue(
      'RESUBMITTED',
    );
    expect(listCompanies).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ filters: { status: 'RESUBMITTED' } }),
    );
  });
});
