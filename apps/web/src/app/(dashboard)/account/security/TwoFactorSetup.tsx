'use client';

import { Copy, Download, Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Input } from '@/components/atoms';
import { FormField, OTPInput, toast } from '@/components/molecules';
import { Stepper } from '@/components/organisms';
import { apiFetch, friendlyApiError } from '@/lib/api/client';

interface Enrollment {
  qrSvg: string;
  manualKey: string;
  backupCodes: string[];
}

const steps = [
  { id: 'password', label: 'Confirm password' },
  { id: 'scan', label: 'Scan & save codes' },
  { id: 'verify', label: 'Enter code' },
];

export function TwoFactorSetup({
  required,
  setupToken,
}: {
  required: boolean;
  /**
   * Audit H-02: when the caller has no session (2FA-required role, never
   * enrolled), login issued this short-lived token instead. It is sent with
   * the password so enrolment can buy exactly the pending session it needs.
   */
  setupToken?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await apiFetch<Enrollment>('/api/v1/account/2fa/enroll', {
        method: 'POST',
        body: setupToken ? { password, setupToken } : { password },
      });
      setEnrollment(data);
      setPassword('');
      setStep(1);
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setPending(false);
    }
  };

  const confirm = async (value = code) => {
    if (value.length !== 6) return;
    setPending(true);
    setError(null);
    try {
      await apiFetch('/api/v1/account/2fa/confirm', { method: 'POST', body: { code: value } });
      toast.success('Two-factor authentication is on');
      if (required) {
        const { data } = await apiFetch<{ homePath: string }>('/api/v1/auth/me');
        router.replace(data.homePath);
      }
      router.refresh();
    } catch (err) {
      setError(friendlyApiError(err));
      setCode('');
      setPending(false);
    }
  };

  const codesText = enrollment?.backupCodes.join('\n') ?? '';

  return (
    <div className="grid gap-5">
      <p className="text-fg-muted text-sm">
        You will need an authenticator app such as Google Authenticator, Microsoft Authenticator or
        Authy on your phone.
      </p>
      <Stepper steps={steps} current={step} />

      {step === 0 && (
        <form className="grid gap-4" onSubmit={start}>
          <FormField label="Your password" required error={error ?? undefined}>
            <Input
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
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
            loading={pending}
            disabled={!password}
            className="justify-self-start"
          >
            Continue
          </Button>
        </form>
      )}

      {step === 1 && enrollment && (
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
            <div
              className="border-border size-[200px] rounded-lg border bg-white p-2"
              role="img"
              aria-label="QR code for your authenticator app"
              // Generated server-side by the qrcode library from our own otpauth URI.
              dangerouslySetInnerHTML={{ __html: enrollment.qrSvg }}
            />
            <div className="grid gap-2 text-sm">
              <p className="text-fg font-medium">
                1. Scan this QR code with your authenticator app.
              </p>
              <p className="text-fg-muted">Can’t scan? Enter this key instead:</p>
              <code className="bg-surface-muted text-fg rounded-md px-2 py-1.5 font-mono text-sm break-all">
                {enrollment.manualKey}
              </code>
            </div>
          </div>

          <div className="border-border bg-surface-muted grid gap-3 rounded-lg border p-4">
            <p className="text-fg text-sm font-medium">2. Save your backup codes</p>
            <p className="text-fg-muted text-sm">
              Each code works once, if you lose your phone. Store them somewhere safe — they will
              not be shown again.
            </p>
            <ul
              className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5"
              aria-label="Backup codes"
            >
              {enrollment.backupCodes.map((c) => (
                <li key={c} className="bg-surface text-fg rounded px-2 py-1 text-center">
                  {c}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Copy />}
                onClick={async () => {
                  await navigator.clipboard.writeText(codesText);
                  setSavedCodes(true);
                  toast.success('Backup codes copied');
                }}
              >
                Copy
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Download />}
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([`Saylani Job Bank backup codes\n\n${codesText}\n`], {
                      type: 'text/plain',
                    }),
                  );
                  const a = Object.assign(document.createElement('a'), {
                    href: url,
                    download: 'jobbank-backup-codes.txt',
                  });
                  a.click();
                  URL.revokeObjectURL(url);
                  setSavedCodes(true);
                }}
              >
                Download
              </Button>
            </div>
            <label className="text-fg flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id="two-factor-saved-codes"
                name="two-factor-saved-codes"
                checked={savedCodes}
                onChange={(e) => setSavedCodes(e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              I have saved my backup codes
            </label>
          </div>
          <Button className="justify-self-start" disabled={!savedCodes} onClick={() => setStep(2)}>
            Next
          </Button>
        </div>
      )}

      {step === 2 && (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <p className="text-fg text-sm">
            3. Enter the 6-digit code shown in your authenticator app.
          </p>
          <OTPInput
            value={code}
            onChange={setCode}
            onComplete={(v) => void confirm(v)}
            disabled={pending}
            invalid={Boolean(error)}
            autoFocus
            label="Authenticator code"
          />
          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(1)} disabled={pending}>
              Back
            </Button>
            <Button type="submit" loading={pending} disabled={code.length !== 6}>
              Turn on two-factor
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
