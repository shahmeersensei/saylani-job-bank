'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TwoFactorSetup } from '@/app/(dashboard)/account/security/TwoFactorSetup';
import { Button } from '@/components/atoms';
import { ErrorBanner } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { PasswordFields, passwordReady } from '../_PasswordFields';

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** Set when activation ends in 2FA enrolment (Staff must enrol before use). */
  const [setupToken, setSetupToken] = useState<string | null>(null);

  /** The server's message for the password field, if it reported one. */
  const passwordError = error instanceof ApiClientError ? error.issueFor('password') : undefined;

  if (setupToken) {
    return (
      <div className="grid gap-4">
        <p className="text-fg-muted text-sm">
          Your account is activated. Your role requires two-factor authentication — set up your
          authenticator app now to finish signing in. This setup link expires in 15 minutes.
        </p>
        <TwoFactorSetup required setupToken={setupToken} />
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setTouched(true);
        if (!passwordReady(password, confirm)) return;
        setPending(true);
        setError(null);
        try {
          const { data } = await apiFetch<{
            kind: string;
            homePath?: string;
            setupToken?: string;
          }>('/api/v1/auth/invitations/accept', {
            method: 'POST',
            body: { token, password },
          });
          // Staff must enrol an authenticator before using the system, so a
          // brand-new invite usually lands here instead of signed_in.
          if (data.kind === 'two_factor_setup_required' && data.setupToken) {
            setSetupToken(data.setupToken);
            return;
          }
          router.replace(data.kind === 'signed_in' && data.homePath ? data.homePath : '/login');
          router.refresh();
        } catch (err) {
          setError(err);
          setPending(false);
        }
      }}
    >
      <PasswordFields
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
        showErrors={touched}
        serverError={passwordError}
      />
      <ErrorBanner error={error ?? undefined} operation="Activate account" />
      <Button type="submit" fullWidth loading={pending}>
        Activate my account
      </Button>
    </form>
  );
}
