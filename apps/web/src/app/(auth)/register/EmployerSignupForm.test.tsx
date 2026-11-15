import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as apiClientModule from '@/lib/api/client';
import { ApiClientError } from '@/lib/api/client';
import { EmployerSignupForm } from './EmployerSignupForm';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClientModule>();
  return { ...actual, apiFetch: apiFetchMock };
});

function codeError() {
  return new ApiClientError(422, {
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Some fields are invalid',
      issues: [{ path: 'code', message: 'The code is incorrect.' }],
      correlation_id: 'test',
    },
  });
}

function emailTakenError() {
  return new ApiClientError(409, {
    error: {
      code: 'CONFLICT',
      message: 'An account with this email already exists. Please sign in instead.',
      details: { reason: 'EMAIL_TAKEN' },
      correlation_id: 'test',
    },
  });
}

async function goToCodeStep(user: ReturnType<typeof userEvent.setup>, resendAfter = 0) {
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/v1/auth/signup/code') {
      return { data: { resendAfterSeconds: resendAfter, expiresInSeconds: 600 } };
    }
    throw new Error(`unexpected call ${path}`);
  });
  render(<EmployerSignupForm />);
  await user.type(screen.getByLabelText(/Work email/), 'owner@example.com');
  await user.click(screen.getByRole('button', { name: 'Send confirmation code' }));
  await waitFor(() => expect(screen.getByText(/We sent a 6-digit code to/)).toBeInTheDocument());
}

describe('EmployerSignupForm — code resend (handwritten note 2)', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    push.mockReset();
  });

  it('shows a disabled "Resend in 60s" button while the server cooldown runs', async () => {
    const user = userEvent.setup();
    await goToCodeStep(user, 60);
    const resend = screen.getByRole('button', { name: 'Resend in 60s' });
    expect(resend).toBeDisabled();
  });

  it('calls the signup-code endpoint again when Resend code is clicked', async () => {
    const user = userEvent.setup();
    await goToCodeStep(user, 0);
    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, '/api/v1/auth/signup/code', {
      method: 'POST',
      body: { email: 'owner@example.com' },
    });
  });
});

describe('EmployerSignupForm — two-factor enrolment after signup', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    push.mockReset();
  });

  it('continues into authenticator setup instead of the dashboard when signup returns a setup token', async () => {
    const user = userEvent.setup();
    await goToCodeStep(user, 0);
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/v1/auth/signup/complete') {
        return {
          data: {
            kind: 'two_factor_setup_required',
            setupToken: 'v1.test-token',
            expiresInSeconds: 900,
          },
        };
      }
      throw new Error(`unexpected call ${path}`);
    });
    await user.type(screen.getByLabelText(/6-digit code/), '123456');
    await user.type(screen.getByLabelText(/Your full name/), 'Aisha Khan');
    await user.type(screen.getByLabelText(/Password/), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(screen.getByText(/Your account is created/)).toBeInTheDocument());
    // The enrolment flow itself is showing (password-confirmation step).
    expect(screen.getByLabelText(/Your password/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('EmployerSignupForm — per-field validation (handwritten note 1)', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    push.mockReset();
  });

  it('shows a wrong code on the code field, not as a page error', async () => {
    const user = userEvent.setup();
    await goToCodeStep(user, 0);
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/v1/auth/signup/complete') throw codeError();
      throw new Error(`unexpected call ${path}`);
    });
    await user.type(screen.getByLabelText(/6-digit code/), '123456');
    await user.type(screen.getByLabelText(/Your full name/), 'Aisha Khan');
    await user.type(screen.getByLabelText(/Password/), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(screen.getByText('The code is incorrect.')).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
    // The message sits on the code field itself (getByText above also proves
    // it is shown exactly once, not duplicated in a page alert).
    const message = screen.getByText('The code is incorrect.').closest('p');
    expect(message).toHaveAttribute('id', expect.stringContaining('-error'));
    expect(screen.getByLabelText(/6-digit code/).getAttribute('aria-describedby')).toContain(
      message?.id,
    );
  });

  it('shows an already-registered email as a page alert, not under the password field', async () => {
    const user = userEvent.setup();
    await goToCodeStep(user, 0);
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/v1/auth/signup/complete') throw emailTakenError();
      throw new Error(`unexpected call ${path}`);
    });
    await user.type(screen.getByLabelText(/6-digit code/), '123456');
    await user.type(screen.getByLabelText(/Your full name/), 'Aisha Khan');
    await user.type(screen.getByLabelText(/Password/), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(
        screen.getByText('An account with this email already exists. Please sign in instead.'),
      ).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });
});
