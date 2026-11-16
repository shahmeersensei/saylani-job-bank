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
  canRegenerate: false,
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
    vi.mocked(apiFetch).mockResolvedValue({ data: { ...form, photoDataUrl: null } });
    render(<RegistrationPrintClient applicantId="applicant-id" />);

    expect(await screen.findByText('No photo on file')).toBeInTheDocument();
    expect(screen.queryByAltText('Applicant photo')).not.toBeInTheDocument();
  });
});
