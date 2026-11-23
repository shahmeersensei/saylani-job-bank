import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClientModule from '@/lib/api/client';
import type { ApplicantStaffView } from '@/domains/applicant';
import { StaffRegisterApplicantForm } from './StaffRegisterApplicantForm';

const { apiFetchMock, pushMock, refreshMock, putWithProgressMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  putWithProgressMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('@/lib/upload/put-with-progress', () => ({
  putWithProgress: putWithProgressMock,
}));

vi.mock('@/components/organisms', () => ({
  MapPinPicker: () => null,
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, apiFetch: apiFetchMock };
});

const applicant: ApplicantStaffView = {
  id: '60ee8ed9-d26a-45fb-b28b-76fd89184080',
  registrationReference: 'SJB-2026-TEST',
  registrationSource: 'STAFF_ASSISTED',
  registeredAt: '2026-01-01T00:00:00.000Z',
  status: 'ACTIVE',
  identityStatus: 'UNVERIFIED',
  identityNote: null,
  branch: null,
  counterRegistered: false,
  personal: {
    fullName: 'Existing Applicant',
    fatherName: 'Applicant Parent',
    cnic: '4210112345671',
    dateOfBirth: '1995-04-12',
    gender: 'FEMALE',
    email: 'applicant@example.test',
    phone: '+923001234567',
  },
  address: {
    addressLine: 'House 12, Block 13-D',
    cityCode: 'KARACHI',
    areaCode: null,
    location: { lat: 24.9256, lng: 67.0899 },
  },
  education: [],
  experience: [],
  hasNoExperience: false,
  skills: [],
  languages: [],
  certifications: [],
  recordIds: { education: [], experience: [], certifications: [] },
  preferences: null,
  documents: [],
  completeness: { percent: 0, sections: [], activationMissing: [] },
  identityLocked: false,
  branchLocked: false,
  permanentAddress: null,
  additionalNotes: null,
  registrationVerifiedSignedAt: null,
  registrationVerifiedSignedBy: null,
  activatedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  userId: '6062ad58-cc05-451e-a7db-d8a5afcc6e37',
  statusReason: null,
  createdByStaff: null,
  identityHistory: [],
  can: {
    verifyIdentity: false,
    manage: true,
    transfer: false,
    shortlist: false,
    scheduleInterview: false,
    referToEmployer: false,
    recordInterviewOutcome: false,
    referPassedOnly: false,
  },
};

const options = {
  branches: [],
  cities: [{ value: 'KARACHI', label: 'Karachi' }],
  areas: [],
  educationLevels: [],
  skills: [],
  languages: [],
  categories: [],
  basePath: '/super-admin/applicants',
};

describe('StaffRegisterApplicantForm edit mode', () => {
  beforeEach(() => {
    apiFetchMock.mockReset().mockResolvedValue({ data: { id: applicant.id } });
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it('prefills the applicant and updates the existing profile through PATCH', async () => {
    const user = userEvent.setup();
    render(<StaffRegisterApplicantForm {...options} applicant={applicant} />);

    expect(screen.getByDisplayValue('Existing Applicant')).toBeInTheDocument();
    expect(screen.getByDisplayValue('applicant@example.test')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+923001234567')).toBeInTheDocument();
    // The Gender field label points at the first radio (FormField + RadioGroup),
    // so its accessible name is the composed "Gender Male", not "Male".
    expect(screen.getByRole('radio', { name: 'Gender Male' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Female' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Prefer not to say' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review profile update' }));
    await user.click(screen.getByRole('button', { name: 'Update Profile' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledTimes(1);
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/api/v1/applicants/${applicant.id}/profile`,
        expect.objectContaining({ method: 'PATCH', body: expect.any(Object) }),
      );
    });
    expect(apiFetchMock.mock.calls[0]?.[0]).not.toBe('/api/v1/applicants/staff-register');
    expect(pushMock).toHaveBeenCalledWith(`/super-admin/applicants/${applicant.id}`);
  });

  it('preserves an existing unspecified gender unless a new option is selected', async () => {
    const user = userEvent.setup();
    render(
      <StaffRegisterApplicantForm
        {...options}
        applicant={{ ...applicant, personal: { ...applicant.personal, gender: 'UNDISCLOSED' } }}
      />,
    );

    expect(screen.getByText(/Gender is currently unspecified/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Gender Male' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Female' })).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Prefer not to say' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review profile update' }));
    await user.click(screen.getByRole('button', { name: 'Update Profile' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/api/v1/applicants/${applicant.id}/profile`,
        expect.objectContaining({ body: expect.objectContaining({ gender: 'UNDISCLOSED' }) }),
      ),
    );
  });

  it('allows an existing unspecified gender to be changed', async () => {
    const user = userEvent.setup();
    render(
      <StaffRegisterApplicantForm
        {...options}
        applicant={{ ...applicant, personal: { ...applicant.personal, gender: 'UNDISCLOSED' } }}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Gender Male' }));
    await user.click(screen.getByRole('button', { name: 'Review profile update' }));
    await user.click(screen.getByRole('button', { name: 'Update Profile' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/api/v1/applicants/${applicant.id}/profile`,
        expect.objectContaining({ body: expect.objectContaining({ gender: 'MALE' }) }),
      ),
    );
  });
});

const issuedToken = {
  id: '11111111-1111-4111-8111-111111111111',
  tokenNumber: 7,
  tokenCode: 'KHI-GULSHAN-007',
  branchId: '22222222-2222-4222-8222-222222222222',
  branchCode: 'KHI-GULSHAN',
  branchName: 'Gulshan',
  cnic: '4210112345671',
  applicantName: 'Ahmed Raza',
  phone: '+923001234567',
  issuedAt: '2026-11-13T09:00:00.000Z',
  expiresAt: '2026-11-13T18:59:59.000Z',
  expired: false,
  status: 'ISSUED' as const,
  applicantId: null,
  registrationReference: 'K7M2X9QP',
};

const tokenOptions = {
  branches: [{ value: issuedToken.branchId, label: 'Gulshan' }],
  cities: [{ value: 'KARACHI', label: 'Karachi' }],
  areas: [],
  educationLevels: [],
  skills: [],
  languages: [],
  categories: [],
  basePath: '/staff/applicants',
};

describe('StaffRegisterApplicantForm token mode', () => {
  beforeEach(() => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-photo');
    globalThis.URL.revokeObjectURL = vi.fn();
    putWithProgressMock.mockReset().mockResolvedValue(undefined);
    apiFetchMock.mockReset().mockImplementation(async (url: string) => {
      if (url.includes('/documents/') && url.includes('/confirm')) return { data: {} };
      if (url.includes('/documents'))
        return {
          data: {
            documentId: '55555555-5555-4555-8555-555555555555',
            upload: { url: 'https://storage.test/photo', headers: {} },
          },
        };
      return {
        data: {
          id: '44444444-4444-4444-8444-444444444444',
          personal: { fullName: 'Ahmed Raza' },
          registrationReference: 'SJB-2026-TEST',
          branch: { name: 'Gulshan' },
          status: 'ACTIVE',
        },
      };
    });
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it('prefills name, CNIC and phone from the token and locks the CNIC', () => {
    render(<StaffRegisterApplicantForm {...tokenOptions} token={issuedToken} />);

    expect(screen.getByDisplayValue('Ahmed Raza')).toBeInTheDocument();
    const cnic = screen.getByDisplayValue('42101-1234567-1');
    expect(cnic).toBeDisabled();
    expect(screen.getByDisplayValue('300 1234567')).toBeInTheDocument();
    expect(screen.queryByLabelText('Original network allocation')).not.toBeInTheDocument();
    expect(screen.getByText(/From the token, locked. If the CNIC is wrong/)).toBeInTheDocument();
  });

  it('submits the token id with the registration and shows the token completed', async () => {
    const user = userEvent.setup();
    // (The document branches mirror the describe-level mock; this
    // implementation replaces it for this test.)
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/documents/') && url.includes('/confirm')) return { data: {} };
      if (url.includes('/documents'))
        return {
          data: {
            documentId: '55555555-5555-4555-8555-555555555555',
            upload: { url: 'https://storage.test/photo', headers: {} },
          },
        };
      return {
        data: {
          id: '44444444-4444-4444-8444-444444444444',
          personal: { fullName: 'Ahmed Raza' },
          registrationReference: 'SJB-2026-TEST',
          branch: { name: 'Gulshan' },
          status: 'ACTIVE',
        },
      };
    });
    render(<StaffRegisterApplicantForm {...tokenOptions} token={issuedToken} />);

    await user.type(screen.getByLabelText(/Father's or husband's name/), 'Imran Raza');
    fireEvent.change(screen.getByLabelText(/Date of birth/), {
      target: { value: '12/04/1998' },
    });
    await user.click(screen.getByRole('radio', { name: 'Gender Male' }));
    await user.selectOptions(screen.getByLabelText(/City/), 'KARACHI');

    await user.upload(
      screen.getByLabelText('Upload a photo file'),
      new File(['fake-jpeg'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    expect(screen.getByAltText('Captured applicant photo preview')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review registration' }));
    expect(screen.getByText('Passport photo captured')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Register job seeker' }));

    await waitFor(() => {
      // Create applicant + photo presign + photo confirm.
      expect(apiFetchMock).toHaveBeenCalledTimes(3);
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/applicants',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            tokenId: issuedToken.id,
            cnic: '4210112345671',
            fullName: 'Ahmed Raza',
            // No home location any more: the form sends a null pin.
            address: expect.objectContaining({ cityCode: 'KARACHI', location: null }),
          }),
        }),
      );
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/applicants/44444444-4444-4444-8444-444444444444/documents',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ typeCode: 'PHOTO', contentType: 'image/jpeg' }),
        }),
      );
    });
    expect(putWithProgressMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://storage.test/photo' }),
    );
    expect(screen.getByText('KHI-GULSHAN-007 · completed')).toBeInTheDocument();
    expect(screen.getByText('Passport photo saved')).toBeInTheDocument();
  });

  it('blocks review until a photo is captured or skipped', async () => {
    const user = userEvent.setup();
    render(<StaffRegisterApplicantForm {...tokenOptions} token={issuedToken} />);

    await user.click(screen.getByRole('button', { name: 'Review registration' }));

    expect(screen.getByText(/Capture the applicant’s photo/)).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
