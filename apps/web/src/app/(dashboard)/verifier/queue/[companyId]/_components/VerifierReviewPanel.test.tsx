import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyView } from '@/domains/company';
import { VerifierReviewPanel } from './VerifierReviewPanel';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

const company = {
  id: 'company-1',
  status: 'UNDER_VERIFICATION',
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
  branch: null,
  documents: [
    {
      id: 'document-1',
      typeCode: 'NTN_CERTIFICATE',
      fileName: 'ntn.pdf',
      reviewStatus: 'PENDING',
      reviewNote: null,
      reviewedBy: null,
      reviewedAt: null,
    },
  ],
  requiredDocuments: [],
  missing: [],
  verification: {
    id: 'verification-1',
    state: 'UNDER_VERIFICATION',
    round: 1,
    assignedVerifierId: 'verifier-1',
    submittedAt: '2026-10-08T00:00:00.000Z',
    slaDueOn: '2026-10-15T00:00:00.000Z',
    infoRequest: null,
    infoRequestedAt: null,
    decidedAt: null,
    decisionNote: null,
    rejectionReasonCode: null,
  },
  editable: false,
  verifiedAt: null,
  createdAt: '2026-10-08T00:00:00.000Z',
} as unknown as CompanyView;

describe('VerifierReviewPanel document acceptance', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({ data: company });
  });

  it('sends the decision field when accepting a document', async () => {
    const user = userEvent.setup();
    render(<VerifierReviewPanel company={company} actorId="verifier-1" />);

    await user.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/companies/company-1/documents/document-1/review',
        {
          method: 'PATCH',
          body: { decision: 'ACCEPTED', note: null },
          idempotencyKey: expect.stringMatching(/[0-9a-f-]{36}/),
        },
      );
    });
  });
});
