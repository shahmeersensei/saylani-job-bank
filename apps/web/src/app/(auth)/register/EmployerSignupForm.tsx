'use client';

import { Eye, EyeOff, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Input } from '@/components/atoms';
import { FormField } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';

type Step = 'email' | 'code';

export function EmployerSignupForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiFetch('/api/v1/auth/signup/code', { method: 'POST', body: { email } });
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  async function complete(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiFetch('/api/v1/auth/signup/complete', {
        method: 'POST',
        body: { email, code, fullName, password },
      });
      router.push('/employer');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  if (step === 'email') {
    return (
      <form className="grid gap-4" onSubmit={(e) => void requestCode(e)}>
        <FormField label="Work email" required error={error ?? undefined}>
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

  return (
    <form className="grid gap-4" onSubmit={(e) => void complete(e)}>
      <p className="text-fg-muted text-sm">
        We sent a 6-digit code to <strong>{email}</strong>. Enter it below along with your name and
        a password.
      </p>
      <FormField label="6-digit code" required>
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
      <FormField label="Your full name" required>
        <Input autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </FormField>
      <FormField label="Password" required error={error ?? undefined}>
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
      <button
        type="button"
        className="text-fg-muted text-center text-sm underline underline-offset-4"
        onClick={() => {
          setStep('email');
          setCode('');
          setError(null);
        }}
      >
        Use a different email
      </button>
    </form>
  );
}
