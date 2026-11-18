import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VerifierCompaniesPage from './page';

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

describe('Verifier company filters', () => {
  it('passes the selected status and search term to the server-side list', async () => {
    listCompanies.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 20, pageCount: 0, total: 0 },
    });
    const page = await VerifierCompaniesPage({
      searchParams: Promise.resolve({ status: 'INFO_REQUESTED', q: 'example' }),
    });
    render(page);

    const statusFilter = screen.getByLabelText('Status');
    expect(statusFilter).toHaveValue('INFO_REQUESTED');
    expect(statusFilter).toHaveClass('bg-surface', 'text-fg');
    expect(screen.getByRole('option', { name: 'Info needed' })).toHaveClass(
      'bg-surface',
      'text-fg',
    );
    expect(screen.getByRole('option', { name: 'Info needed' })).toHaveValue('INFO_REQUESTED');
    expect(listCompanies).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ q: 'example', filters: { status: 'INFO_REQUESTED' } }),
    );
  });

  it('keeps all statuses visible by default', async () => {
    listCompanies.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 20, pageCount: 0, total: 0 },
    });
    const page = await VerifierCompaniesPage({ searchParams: Promise.resolve({}) });
    render(page);

    expect(screen.getByLabelText('Status')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'All statuses' })).toBeInTheDocument();
    expect(listCompanies).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ filters: {} }),
    );
  });
});
