import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClientModule from '@/lib/api/client';
import type { ApplicantTokenView } from '@jobbank/shared';
import { TokenRegistrationFlow } from './TokenRegistrationFlow';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, apiFetch: apiFetchMock };
});

vi.mock('./StaffRegisterApplicantForm', () => ({
  StaffRegisterApplicantForm: ({ token }: { token?: ApplicantTokenView }) => (
    <div data-testid="registration-form">Registration form for {token?.tokenCode}</div>
  ),
}));

const issuedToken: ApplicantTokenView = {
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
  status: 'ISSUED',
  applicantId: null,
  registrationReference: 'K7M2X9QP',
};

const props = {
  branches: [{ value: issuedToken.branchId, label: 'Gulshan', code: 'KHI-GULSHAN' }],
  cities: [],
  areas: [],
  educationLevels: [],
  skills: [],
  languages: [],
  categories: [],
  basePath: '/staff/applicants',
};

describe('TokenRegistrationFlow', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('asks for a token code or CNIC before searching', async () => {
    const user = userEvent.setup();
    render(<TokenRegistrationFlow {...props} />);

    await user.click(screen.getByRole('button', { name: 'Find token' }));

    expect(screen.getByText('Enter a token code or a CNIC number')).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('finds an issued token by code and opens the form for it', async () => {
    const user = userEvent.setup();
    apiFetchMock.mockResolvedValue({ data: [issuedToken] });
    render(<TokenRegistrationFlow {...props} />);

    await user.type(screen.getByPlaceholderText('001'), 'khi-gulshan-007');
    await user.click(screen.getByRole('button', { name: 'Find token' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/applicants/tokens?tokenCode=KHI-GULSHAN-007&branchId=22222222-2222-4222-8222-222222222222',
      ),
    );
    expect(screen.getByText(/Ahmed Raza/)).toBeInTheDocument();
    expect(screen.getByText('Ready to register')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open registration form' }));
    expect(screen.getByTestId('registration-form')).toHaveTextContent(
      'Registration form for KHI-GULSHAN-007',
    );
  });

  it('does not offer the form for a completed token', async () => {
    const user = userEvent.setup();
    apiFetchMock.mockResolvedValue({
      data: [
        {
          ...issuedToken,
          status: 'COMPLETED',
          applicantId: '33333333-3333-4333-8333-333333333333',
        },
      ],
    });
    render(<TokenRegistrationFlow {...props} />);

    await user.type(screen.getByPlaceholderText('001'), 'KHI-GULSHAN-007');
    await user.click(screen.getByRole('button', { name: 'Find token' }));

    await waitFor(() => expect(screen.getByText('Already registered')).toBeInTheDocument());
    expect(screen.getByText('The applicant is already registered.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open registration form' }),
    ).not.toBeInTheDocument();
  });

  it('shows a message when no token is found', async () => {
    const user = userEvent.setup();
    apiFetchMock.mockResolvedValue({ data: [] });
    render(<TokenRegistrationFlow {...props} />);

    await user.type(screen.getByPlaceholderText('001'), 'KHI-GULSHAN-007');
    await user.click(screen.getByRole('button', { name: 'Find token' }));

    await waitFor(() => expect(screen.getByText(/No token found/)).toBeInTheDocument());
  });

  it('auto-detects the full code from just the number at a single branch', async () => {
    const user = userEvent.setup();
    apiFetchMock.mockResolvedValue({ data: [issuedToken] });
    render(<TokenRegistrationFlow {...props} />);

    await user.type(screen.getByPlaceholderText('001'), '007');

    expect(screen.getByText('Auto-detected: KHI-GULSHAN-007')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Find token' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/applicants/tokens?tokenCode=007&branchId=22222222-2222-4222-8222-222222222222',
      ),
    );
    expect(screen.getByText(/Ahmed Raza/)).toBeInTheDocument();
  });

  it('asks for a branch when the number alone is typed with several branches', async () => {
    const user = userEvent.setup();
    render(
      <TokenRegistrationFlow
        {...props}
        branches={[
          ...props.branches,
          {
            value: '44444444-4444-4444-8444-444444444444',
            label: 'North Nazimabad',
            code: 'KHI-NORTH',
          },
        ]}
      />,
    );

    await user.type(screen.getByPlaceholderText('001'), '007');
    await user.click(screen.getByRole('button', { name: 'Find token' }));

    expect(
      screen.getByText('Choose a branch — a number alone does not say which branch it is from'),
    ).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
