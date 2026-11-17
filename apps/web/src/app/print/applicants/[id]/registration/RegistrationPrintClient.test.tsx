import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationPrintClient } from './RegistrationPrintClient';
import type { RegistrationFormData } from '@/domains/applicant';
import { apiFetch } from '@/lib/api/client';

vi.mock('@/lib/api/client', () => ({
  ApiClientError: class ApiClientError extends Error {
    issues = [];
  },
  apiFetch: vi.fn(),
}));

const form: RegistrationFormData = {
  registrationReference: 'SJB-2026-0123456789ABCDEF',
  registeredAt: '2026-10-12T12:00:00.000Z',
  registrationSource: 'Staff-assisted registration',
  status: 'ACTIVE',
  branchName: 'Gulshan Branch',
  registeredByName: 'Registration Administrator',
  personal: {
    fullName: 'Latest Saved Applicant',
    fatherName: 'Test Parent',
    cnic: '4210112345671',
    dateOfBirth: '1998-04-12',
    gender: 'FEMALE',
    phone: null,
    email: null,
  },
  address: null,
  education: [],
  experience: [],
  hasNoExperience: true,
  skills: [],
  languages: [],
  certifications: [],
  preferences: null,
  verificationQrDataUrl: 'data:image/png;base64,dGVzdA==',
  photoDataUrl: 'data:image/jpeg;base64,dGVzdA==',
  photoUrl: '/api/v1/applicants/applicant-id/documents/doc-1/download',
  canRegenerate: false,
  photoDocumentId: null,
};

describe('RegistrationPrintClient', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue({ data: form });
  });

  it('loads the saved record and enables printing only after the logo and QR are ready', async () => {
    render(<RegistrationPrintClient applicantId="applicant-id" />);

    expect(await screen.findByText('Latest Saved Applicant')).toBeInTheDocument();
    expect(screen.getAllByText('SJB-2026-0123456789ABCDEF')).toHaveLength(2);
    expect(screen.getByText('No Previous Work Experience')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/applicants/applicant-id/registration-form', {
      method: 'POST',
    });

    const printButton = screen.getByRole('button', { name: 'Preparing form…' });
    expect(printButton).toBeDisabled();
    fireEvent.load(screen.getByAltText('Saylani'));
    fireEvent.load(screen.getByAltText('QR code for secure registration verification'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Print Registration Form' })).toBeEnabled();
    });

    const print = vi.fn();
    Object.defineProperty(window, 'print', { configurable: true, value: print });
    fireEvent.click(screen.getByRole('button', { name: 'Print Registration Form' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('shows the applicant photo beside the personal details', async () => {
    render(<RegistrationPrintClient applicantId="applicant-id" />);

    const photo = await screen.findByAltText('Applicant photo');
    expect(photo).toHaveAttribute('src', 'data:image/jpeg;base64,dGVzdA==');
    expect(screen.queryByText('No photo on file')).not.toBeInTheDocument();
  });

  it('shows a placeholder box when no photo is on file', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      data: { ...form, photoDataUrl: null, photoUrl: null },
    });
    render(<RegistrationPrintClient applicantId="applicant-id" />);

    expect(await screen.findByText('No photo on file')).toBeInTheDocument();
    expect(screen.queryByAltText('Applicant photo')).not.toBeInTheDocument();
  });

  it('uses the download link when the server could not embed the photo', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ data: { ...form, photoDataUrl: null } });
    render(<RegistrationPrintClient applicantId="applicant-id" />);

    const photo = await screen.findByAltText('Applicant photo');
    // jsdom absolutises a relative src; the path is what matters.
    expect(photo.getAttribute('src')).toContain(
      '/api/v1/applicants/applicant-id/documents/doc-1/download',
    );
    expect(screen.queryByText('No photo on file')).not.toBeInTheDocument();
  });

  it('falls back to the download link when the embedded photo fails to render', async () => {
    render(<RegistrationPrintClient applicantId="applicant-id" />);

    const photo = await screen.findByAltText('Applicant photo');
    expect(photo).toHaveAttribute('src', 'data:image/jpeg;base64,dGVzdA==');
    fireEvent.error(photo);

    await waitFor(() => {
      expect(screen.getByAltText('Applicant photo').getAttribute('src')).toContain(
        '/api/v1/applicants/applicant-id/documents/doc-1/download',
      );
    });
    expect(screen.queryByText('No photo on file')).not.toBeInTheDocument();
    expect(screen.queryByText('Photo could not be loaded')).not.toBeInTheDocument();
  });

  it('says the photo could not be loaded when neither photo source renders', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ data: { ...form, photoDataUrl: null } });
    render(<RegistrationPrintClient applicantId="applicant-id" />);

    fireEvent.error(await screen.findByAltText('Applicant photo'));

    expect(await screen.findByText('Photo could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('No photo on file')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Applicant photo')).not.toBeInTheDocument();
  });

  it('shows the passport photo top-right and refreshes its link before printing', async () => {
    const photoForm = { ...form, photoDocumentId: '00000000-0000-0000-0000-000000000099' };
    vi.mocked(apiFetch).mockImplementation((path: string) =>
      path.includes('/documents/')
        ? Promise.resolve({
            data: {
              url: 'https://example.invalid/photo.jpg',
              expiresAt: '2026-11-08T00:00:00.000Z',
            },
          })
        : Promise.resolve({ data: photoForm }),
    );

    render(<RegistrationPrintClient applicantId="applicant-id" />);

    const photo = await screen.findByAltText('Applicant passport photo');
    expect(photo).toHaveAttribute('src', 'https://example.invalid/photo.jpg');
    expect(photo).toHaveClass('registration-print-photo');

    // Print stays disabled until the photo has settled, like logo and QR.
    expect(screen.getByRole('button', { name: 'Preparing form…' })).toBeDisabled();
    fireEvent.load(screen.getByAltText('Saylani'));
    fireEvent.load(screen.getByAltText('QR code for secure registration verification'));
    fireEvent.load(photo);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Print Registration Form' })).toBeEnabled();
    });

    const print = vi.fn();
    Object.defineProperty(window, 'print', { configurable: true, value: print });
    fireEvent.click(screen.getByRole('button', { name: 'Print Registration Form' }));
    // Print waits for the fresh link (and the 1.5s preload cap at most).
    await waitFor(() => expect(print).toHaveBeenCalledOnce(), { timeout: 5000 });
    const photoLinkCalls = vi
      .mocked(apiFetch)
      .mock.calls.filter(
        ([calledPath]) => typeof calledPath === 'string' && calledPath.includes('/documents/'),
      );
    // Once on load, once on print.
    expect(photoLinkCalls.length).toBeGreaterThanOrEqual(2);
  });
});
