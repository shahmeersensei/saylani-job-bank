import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyWizard } from './CompanyWizard';

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

describe('CompanyWizard', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/v1/master-data?type=INDUSTRY') {
        return { data: [{ code: 'IT', label: 'Information technology' }] };
      }
      if (path === '/api/v1/companies/me/submit') {
        return {
          data: {
            id: 'company-1',
            status: 'SUBMITTED',
            branch: null,
            details: {
              legalName: 'Example Company',
              tradeName: null,
              legalStructure: 'PRIVATE_LIMITED',
              ntn: '1234567-8',
              registrationNo: null,
              industryCode: 'IT',
              sizeBand: '1_10',
              website: null,
              description: null,
            },
            contacts: [],
            headOffice: null,
            sites: [],
            documents: [],
            requiredDocuments: [],
            missing: [],
            verification: null,
            editable: true,
            verifiedAt: null,
            createdAt: '2026-10-08T00:00:00.000Z',
          },
        };
      }
      return {
        data: {
          id: 'company-1',
          status: 'DRAFT',
          details: {
            legalName: 'Example Company',
            legalStructure: 'LIMITED',
            ntn: '1234567-8',
            industryCode: 'IT',
            sizeBand: '1-10',
          },
          contacts: [],
          sites: [],
          documents: [],
          verification: null,
        },
      };
    });
  });

  it('sends an idempotency key when registering company details', async () => {
    const user = userEvent.setup();
    render(<CompanyWizard initialStep="details" initialCompany={null} />);

    await user.type(screen.getByLabelText(/Registered company name/), 'Example Company');
    await user.selectOptions(screen.getByLabelText(/Business type/), 'PRIVATE_LIMITED');
    await user.type(screen.getByLabelText(/NTN \(National Tax Number\)/), '1234567-8');
    const industry = screen.getByLabelText(/Industry/);
    await waitFor(() => expect(industry).toHaveTextContent('Information technology'));
    await user.selectOptions(industry, 'IT');
    await user.selectOptions(screen.getByLabelText(/Company size/), '1_10');
    const saveButton = screen.getByRole('button', { name: 'Save and continue' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/companies/register', {
        method: 'POST',
        body: expect.any(Object),
        idempotencyKey: expect.stringMatching(/[0-9a-f-]{36}/),
      }),
    );
  });

  it('sends an idempotency key when submitting company data for verification', async () => {
    const user = userEvent.setup();
    render(
      <CompanyWizard
        initialStep="submit"
        initialCompany={{
          id: 'company-1',
          status: 'DRAFT',
          branch: null,
          details: {
            legalName: 'Example Company',
            tradeName: null,
            legalStructure: 'PRIVATE_LIMITED',
            ntn: '1234567-8',
            registrationNo: null,
            industryCode: 'IT',
            sizeBand: '1_10',
            website: null,
            description: null,
          },
          contacts: [],
          headOffice: null,
          sites: [],
          documents: [],
          requiredDocuments: [],
          missing: [],
          verification: null,
          editable: {
            details: true,
            legal: true,
            contacts: true,
            locations: true,
            branch: true,
            documents: true,
          },
          verifiedAt: null,
          createdAt: '2026-10-01T00:00:00.000Z',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Submit for verification' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/companies/me/submit', {
        method: 'POST',
        idempotencyKey: expect.stringMatching(/[0-9a-f-]{36}/),
      }),
    );
  });
});
