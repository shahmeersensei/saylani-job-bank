'use client';

import { Eye, EyeOff, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TwoFactorSetup } from '@/app/(dashboard)/account/security/TwoFactorSetup';
import { Button, Input } from '@/components/atoms';
import { FormField } from '@/components/molecules';
import { ApiClientError, apiFetch, friendlyApiError } from '@/lib/api/client';

type Step = 'email' | 'code';

type FieldErrors = Partial<Record<'email' | 'code' | 'fullName' | 'password', string>>;

/** Same 1s-tick countdown as LoginForm's "Resend in Ns" button. */
function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return [seconds, setSeconds] as const;
}

/** The server's message for one field, if it reported one for it. */
function issueFor(err: unknown, path: string): string | undefined {
  return err instanceof ApiClientError ? err.issueFor(path) : undefined;
}

function fallbackMessage(err: unknown): string {
  return friendlyApiError(err);
}

export function EmployerSignupForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [resendIn, setResendIn] = useCountdown();
  /** Set when signup ends in 2FA enrolment (every new employer must enrol). */
  const [setupToken, setSetupToken] = useState<string | null>(null);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setPending(true);
    setFieldErrors({});
    setAlert(null);
    try {
      const { data } = await apiFetch<{ resendAfterSeconds: number }>('/api/v1/auth/signup/code', {
        method: 'POST',
        body: { email },
      });
      setResendIn(data.resendAfterSeconds);
      setStep('code');
    } catch (err) {
      const emailError = issueFor(err, 'email');
      if (emailError) setFieldErrors({ email: emailError });
      else setAlert(fallbackMessage(err));
    } finally {
      setPending(false);
    }
  }

  /** Re-sends the confirmation code; the server enforces one resend per minute. */
  async function resendCode() {
    if (resendIn > 0 || pending) return;
    setPending(true);
    setFieldErrors({});
    setAlert(null);
    try {
      const { data } = await apiFetch<{ resendAfterSeconds: number }>('/api/v1/auth/signup/code', {
        method: 'POST',
        body: { email },
      });
      setResendIn(data.resendAfterSeconds);
    } catch (err) {
      // A too-soon resend is a rate-limit error, not a field error.
      setAlert(fallbackMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function complete(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setFieldErrors({});
    setAlert(null);
    try {
      const { data } = await apiFetch<
        | { kind: 'signed_in'; homePath: string }
        | { kind: 'two_factor_setup_required'; setupToken: string; expiresInSeconds: number }
      >('/api/v1/auth/signup/complete', {
        method: 'POST',
        body: { email, code, fullName, password },
      });
      // Employers must enrol an authenticator before using the system, so a
      // brand-new account always lands here: finish enrolment to sign in.
      if (data.kind === 'two_factor_setup_required') {
        setSetupToken(data.setupToken);
        return;
      }
      router.push('/employer');
    } catch (err) {
      // A wrong/expired code, a bad name or a weak password is reported on
      // its own field; anything else (e.g. the email already has an account)
      // goes to the alert above the form, never under the password field.
      const errors: FieldErrors = {
        code: issueFor(err, 'code'),
        fullName: issueFor(err, 'fullName'),
        password: issueFor(err, 'password'),
      };
      const shown = Object.fromEntries(
        Object.entries(errors).filter(([, value]) => value !== undefined),
      ) as FieldErrors;
      setFieldErrors(shown);
      if (err instanceof ApiClientError) {
        const leftover = err.issues.filter(
          (issue) => shown[issue.path as keyof FieldErrors] === undefined,
        );
        if (leftover.length > 0) setAlert(leftover.map((issue) => issue.message).join(' '));
        else if (Object.keys(shown).length === 0) setAlert(fallbackMessage(err));
      } else if (Object.keys(shown).length === 0) {
        setAlert(fallbackMessage(err));
      }
    } finally {
      setPending(false);
    }
  }

  if (step === 'email') {
    return (
      <form className="grid gap-4" onSubmit={(e) => void requestCode(e)}>
        {alert && (
          <p
            role="alert"
            className="bg-danger-soft text-danger-soft-fg rounded-lg px-3 py-2 text-sm"
          >
            {alert}
          </p>
        )}
        <FormField label="Work email" required error={fieldErrors.email}>
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            startAdornment={<Mail aria-hidden="true" />}
            autoFocus
          />
        </FormField>
        <Button type="submit" fullWidth loading={pending} disabled={!email.includes('@')}>
          Send confirmation code
        </Button>
      </form>
    );
  }

  if (setupToken) {
    return (
      <div className="grid gap-4">
        <p className="text-fg-muted text-sm">
          Your account is created. Employers must use two-factor authentication — set up your
          authenticator app now to finish signing in. This setup link expires in 15 minutes.
        </p>
        <TwoFactorSetup required setupToken={setupToken} />
      </div>
    );
  }

  return (
    <form className="grid gap-4" onSubmit={(e) => void complete(e)}>
      {alert && (
        <p role="alert" className="bg-danger-soft text-danger-soft-fg rounded-lg px-3 py-2 text-sm">
          {alert}
        </p>
      )}
      <p className="text-fg-muted text-sm">
        We sent a 6-digit code to <strong>{email}</strong>. Enter it below along with your name and
        a password.
      </p>
      <FormField label="6-digit code" required error={fieldErrors.code}>
        <Input
          type="text"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          autoFocus
        />
      </FormField>
      <FormField label="Your full name" required error={fieldErrors.fullName}>
        <Input autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </FormField>
      <FormField label="Password" required error={fieldErrors.password}>
        <Input
          type={showPw ? 'text' : 'password'}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          endAdornment={
            <button
              type="button"
              aria-label={showPw ? 'Hide password' : 'Show password'}
              onClick={() => setShowPw((v) => !v)}
              className="text-fg-muted"
            >
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
        />
      </FormField>
      <Button
        type="submit"
        fullWidth
        loading={pending}
        disabled={code.length < 6 || !fullName.trim() || password.length < 8}
      >
        Create account
      </Button>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="text-fg-muted text-sm underline underline-offset-4"
          onClick={() => {
            setStep('email');
            setCode('');
            setFieldErrors({});
            setAlert(null);
          }}
        >
          Use a different email
        </button>
        <Button variant="link" disabled={resendIn > 0 || pending} onClick={() => void resendCode()}>
          {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
        </Button>
      </div>
    </form>
  );
}
