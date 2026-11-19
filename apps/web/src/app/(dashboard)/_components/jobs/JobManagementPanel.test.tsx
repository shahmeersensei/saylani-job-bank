import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createJobSchema } from '@jobbank/shared';
import type * as ApiClientModule from '@/lib/api/client';
import type { JobView } from '@/domains/job';
import { JobManagementPanel } from './JobManagementPanel';

const { apiFetchMock, refreshMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, apiFetch: apiFetchMock };
});

const savedJob: JobView = {
  id: '00000000-0000-4000-8000-000000000101',
  companyId: '00000000-0000-4000-8000-000000000001',
  branchId: '00000000-0000-4000-8000-000000000002',
  title: 'Retail assistant',
  categoryCode: 'RETAIL_SALES',
  description: 'A detailed job description for the new role.',
  jobType: 'FULL_TIME',
  shift: 'DAY',
  shiftHours: null,
  designationCode: null,
  genderPreference: 'ANY',
  vacancies: 1,
  vacanciesFilled: 0,
  salaryMin: null,
  salaryMax: null,
  status: 'DRAFT',
  closesAt: null,
  publishedAt: null,
  closedAt: null,
  reopenedAt: null,
  fuelAllowance: false,
  flexibleHours: false,
  annualLeaveDays: 14,
  sickLeaveDays: 10,
  casualLeaveDays: 10,
  medicalCoverage: 'NONE',
  opdLimit: null,
  ipdLimit: null,
  medicalCoverageScope: null,
  bonusTier: 'NONE',
  bonusBasis: null,
  bonusAmountPkr: null,
  bonusFrequency: null,
  workFromHome: false,
  providentFund: false,
  transportAllowance: false,
  eobi: false,
  lifeInsurance: false,
  locations: [],
  requirements: null,
  skills: [],
  createdBy: '00000000-0000-4000-8000-000000000003',
  createdAt: '2026-11-06T00:00:00.000Z',
  updatedAt: '2026-11-06T00:00:00.000Z',
};

const categories = [{ code: 'RETAIL_SALES', label: 'Retail sales' }];

describe('JobManagementPanel', () => {
  beforeEach(() => {
    apiFetchMock.mockReset().mockResolvedValue({ data: savedJob });
    refreshMock.mockReset();
  });

  it('creates a global job for a selected eligible company using the shared API', async () => {
    const user = userEvent.setup();
    render(
      <JobManagementPanel
        jobs={[]}
        companies={[{ id: savedJob.companyId, name: 'Verified company' }]}
        categories={categories}
        canManage
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add job' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company' }), savedJob.companyId);
    await user.type(screen.getByRole('textbox', { name: 'Job title' }), savedJob.title);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'RETAIL_SALES');
    await user.type(screen.getByRole('textbox', { name: 'Description' }), savedJob.description);
    await user.click(screen.getByRole('button', { name: 'Create job draft' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/jobs',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ companyId: savedJob.companyId }),
          idempotencyKey: expect.stringMatching(/[0-9a-f-]{36}/),
        }),
      );
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(savedJob.title)).toBeInTheDocument();
  }, 15_000);

  it('edits the existing record with server-enforced company context', async () => {
    const user = userEvent.setup();
    apiFetchMock.mockResolvedValueOnce({
      data: { ...savedJob, title: 'Updated retail assistant' },
    });
    render(
      <JobManagementPanel
        companyId={savedJob.companyId}
        jobs={[savedJob]}
        categories={categories}
        canManage
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const title = screen.getByRole('textbox', { name: 'Job title' });
    await user.clear(title);
    await user.type(title, 'Updated retail assistant');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/api/v1/companies/${savedJob.companyId}/jobs/${savedJob.id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({ title: 'Updated retail assistant' }),
        }),
      );
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
    const [, options] = apiFetchMock.mock.calls[0]!;
    expect(options.body).not.toHaveProperty('companyId');
    expect(options.body).not.toHaveProperty('companyScopeId');
    expect(screen.getByText('Updated retail assistant')).toBeInTheDocument();
  });

  it('edits a global job when multiple companies are available', async () => {
    const user = userEvent.setup();
    apiFetchMock.mockResolvedValueOnce({
      data: { ...savedJob, title: 'Updated global job' },
    });
    render(
      <JobManagementPanel
        jobs={[savedJob]}
        companies={[
          { id: savedJob.companyId, name: 'First company' },
          { id: '00000000-0000-4000-8000-000000000004', name: 'Second company' },
        ]}
        categories={categories}
        jobBasePath="/super-admin/jobs"
        canManage
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const title = screen.getByRole('textbox', { name: 'Job title' });
    await user.clear(title);
    await user.type(title, 'Updated global job');
    const submit = screen.getByRole('button', { name: 'Save changes' });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/api/v1/jobs/${savedJob.id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({ title: 'Updated global job' }),
        }),
      );
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
    expect(apiFetchMock.mock.calls[0]![1].body).not.toHaveProperty('companyId');
  }, 15_000);

  it('creates from a company profile without allowing the browser to choose another company', async () => {
    const user = userEvent.setup();
    render(
      <JobManagementPanel
        companyId={savedJob.companyId}
        jobs={[]}
        categories={categories}
        canManage
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add job' }));
    expect(screen.getByRole('combobox', { name: 'Shift' })).toHaveValue('ROTATING');
    expect(screen.queryByRole('option', { name: 'Day shift' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Job title' }), savedJob.title);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'RETAIL_SALES');
    await user.type(screen.getByRole('textbox', { name: 'Description' }), savedJob.description);
    await user.click(screen.getByRole('button', { name: 'Create job draft' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/api/v1/companies/${savedJob.companyId}/jobs`,
        expect.objectContaining({
          method: 'POST',
          body: expect.not.objectContaining({ companyId: expect.anything() }),
          idempotencyKey: expect.stringMatching(/[0-9a-f-]{36}/),
        }),
      );
    });
    expect(createJobSchema.safeParse(apiFetchMock.mock.calls[0]![1].body).success).toBe(true);
  }, 15_000);

  it('collects shift hours for rotating job types before posting', async () => {
    const user = userEvent.setup();
    render(
      <JobManagementPanel
        companyId={savedJob.companyId}
        jobs={[]}
        categories={categories}
        canManage
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add job' }));
    await user.type(screen.getByRole('textbox', { name: 'Job title' }), savedJob.title);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'RETAIL_SALES');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Job type' }), 'ROTATING');
    await user.type(screen.getByRole('textbox', { name: 'Description' }), savedJob.description);
    const submit = screen.getByRole('button', { name: 'Create job draft' });
    expect(screen.getByRole('spinbutton', { name: 'Hours per shift' })).toBeVisible();
    expect(submit).toBeDisabled();

    await user.type(screen.getByRole('spinbutton', { name: 'Hours per shift' }), '8');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/api/v1/companies/${savedJob.companyId}/jobs`,
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ jobType: 'ROTATING', shiftHours: 8 }),
        }),
      );
    });
    expect(createJobSchema.safeParse(apiFetchMock.mock.calls[0]![1].body).success).toBe(true);
  }, 15_000);

  it('keeps job visibility but hides mutations without the existing permission', () => {
    render(
      <JobManagementPanel
        jobs={[{ ...savedJob, companyName: 'Verified company' }]}
        categories={[]}
        canManage={false}
      />,
    );

    expect(screen.getByText(savedJob.title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add job' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('uses a full-card link without nesting management buttons inside it', async () => {
    const user = userEvent.setup();
    const base = `/branch-admin/companies/${savedJob.companyId}`;
    render(
      <JobManagementPanel
        companyId={savedJob.companyId}
        jobs={[savedJob]}
        categories={categories}
        jobLinkBasePath={base}
        canManage
      />,
    );
    const link = screen.getByRole('link', { name: savedJob.title });
    expect(link).toHaveAttribute('href', `${base}/${savedJob.id}`);
    expect(link).toHaveClass('absolute', 'inset-0');
    expect(link).toHaveClass('focus-visible:ring-2');
    expect(link.querySelector('button')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'Job title' })).toHaveValue(savedJob.title);
  });
});
