'use client';

import { ArrowLeft, Briefcase, KeyRound, Lock, Mail, Shield, UserRound } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Checkbox, Input } from '@/components/atoms';
import { FormField, OTPInput, PhoneInput, Tabs } from '@/components/molecules';
import { ApiClientError, apiFetch, safeNextPath } from '@/lib/api/client';
import { formatPkMobileDisplay } from '@/lib/format/phone';

interface SignedIn {
  kind: 'signed_in';
  homePath: string;
}
interface TwoFactorRequired {
  kind: 'two_factor_required';
  methods: string[];
}

function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return [seconds, setSeconds] as const;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : 'Something went wrong. Please try again.';
}

function useFinishSignIn(next: string | null) {
  const router = useRouter();
  return (result: SignedIn) => {
    router.replace(safeNextPath(next) ?? result.homePath);
    router.refresh();
  };
}

function Alert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="bg-danger-soft text-danger-soft-fg rounded-lg px-3 py-2 text-sm">
      {message}
    </p>
  );
}

function CodeStep({
  destination,
  onVerify,
  onResend,
  onBack,
  resendIn,
  pending,
  error,
}: {
  destination: string;
  onVerify: (code: string) => void;
  onResend: () => void;
  onBack: () => void;
  resendIn: number;
  pending: boolean;
  error: string | null;
}) {
  const [code, setCode] = useState('');
  useEffect(() => {
    if (error) setCode('');
  }, [error]);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (code.length === 6) onVerify(code);
      }}
    >
      <p className="text-fg-muted text-sm">
        Enter the 6-digit code sent to{' '}
        <span className="text-fg numeric font-medium">{destination}</span>.
      </p>
      <OTPInput
        value={code}
        onChange={setCode}
        onComplete={onVerify}
        disabled={pending}
        invalid={Boolean(error)}
        autoFocus
      />
      <Alert message={error} />
      <Button type="submit" fullWidth disabled={code.length < 6} loading={pending}>
        Verify and continue
      </Button>
      <div className="flex items-center justify-between text-sm">
        <Button variant="link" leftIcon={<ArrowLeft />} onClick={onBack}>
          Back
        </Button>
        <Button variant="link" disabled={resendIn > 0 || pending} onClick={onResend}>
          {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
        </Button>
      </div>
    </form>
  );
}

// ─── Job seekers: phone + SMS ──────────────────────────────────────────

function PhoneSignIn({ next, onBack }: { next: string | null; onBack: () => void }) {
  const finish = useFinishSignIn(next);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useCountdown();

  const sendCode = async () => {
    if (!phone) return;
    setPending(true);
    setError(null);
    try {
      const { data } = await apiFetch<{ resendAfterSeconds: number }>('/api/v1/auth/otp/request', {
        method: 'POST',
        body: { phone },
      });
      setStep('code');
      setResendIn(data.resendAfterSeconds);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const verify = async (code: string) => {
    if (!phone) return;
    setPending(true);
    setError(null);
    try {
      const { data } = await apiFetch<SignedIn>('/api/v1/auth/otp/verify', {
        method: 'POST',
        body: { phone, code },
      });
      finish(data);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  if (step === 'code' && phone) {
    return (
      <CodeStep
        destination={formatPkMobileDisplay(phone)}
        onVerify={(code) => void verify(code)}
        onResend={() => void sendCode()}
        onBack={() => {
          setStep('phone');
          setError(null);
        }}
        resendIn={resendIn}
        pending={pending}
        error={error}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 text-sm"
        style={{ color: 'var(--fg-muted)' }}
      >
        <ArrowLeft className="size-4" />
        Change role
      </button>
      <form
        className="grid gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void sendCode();
        }}
      >
        <FormField
          label="Mobile number"
          required
          error={error ?? undefined}
          hint="New here? Your account is created when you verify."
        >
          <PhoneInput autoFocus onChange={(change) => setPhone(change.e164)} />
        </FormField>
        <Button type="submit" fullWidth disabled={!phone} loading={pending}>
          Send code
        </Button>
      </form>
    </div>
  );
}

// ─── Staff & employers ─────────────────────────────────────────────────

function AuthenticatorStep({
  onDone,
  onBack,
}: {
  onDone: (result: SignedIn) => void;
  onBack: () => void;
}) {
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async (value?: string) => {
    setPending(true);
    setError(null);
    try {
      const body = useBackup
        ? { backupCode: backupCode.trim(), trustDevice }
        : { code: value ?? code, trustDevice };
      const { data } = await apiFetch<SignedIn>('/api/v1/auth/2fa/verify', {
        method: 'POST',
        body,
      });
      onDone(data);
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      setPending(false);
    }
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void verify();
      }}
    >
      <div className="bg-surface-muted text-fg-muted flex items-start gap-3 rounded-lg p-3 text-sm">
        <KeyRound className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {useBackup
          ? 'Enter one of your saved backup codes.'
          : 'Open your authenticator app and enter the 6-digit code for Saylani Job Bank.'}
      </div>
      {useBackup ? (
        <FormField label="Backup code" required>
          <Input
            value={backupCode}
            onChange={(e) => setBackupCode(e.target.value)}
            autoComplete="one-time-code"
            autoFocus
            className="font-mono"
          />
        </FormField>
      ) : (
        <OTPInput
          value={code}
          onChange={setCode}
          onComplete={(v) => void verify(v)}
          disabled={pending}
          invalid={Boolean(error)}
          autoFocus
          label="Authenticator code"
        />
      )}
      <Checkbox
        label="Trust this device for 30 days"
        checked={trustDevice}
        onCheckedChange={(v) => setTrustDevice(v === true)}
      />
      <Alert message={error} />
      <Button
        type="submit"
        fullWidth
        loading={pending}
        disabled={useBackup ? backupCode.trim().length < 6 : code.length !== 6}
      >
        Verify and sign in
      </Button>
      <div className="flex items-center justify-between text-sm">
        <Button variant="link" leftIcon={<ArrowLeft />} onClick={onBack}>
          Back
        </Button>
        <Button
          variant="link"
          onClick={() => {
            setUseBackup((v) => !v);
            setError(null);
          }}
        >
          {useBackup ? 'Use authenticator app' : 'Use a backup code'}
        </Button>
      </div>
    </form>
  );
}

function EmailCodeSignIn({ next, onBack }: { next: string | null; onBack: () => void }) {
  const finish = useFinishSignIn(next);
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useCountdown();

  const send = async () => {
    setPending(true);
    setError(null);
    try {
      const { data } = await apiFetch<{ resendAfterSeconds: number }>(
        '/api/v1/auth/email-otp/request',
        { method: 'POST', body: { email } },
      );
      setStep('code');
      setResendIn(data.resendAfterSeconds);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const verify = async (code: string) => {
    setPending(true);
    setError(null);
    try {
      const { data } = await apiFetch<SignedIn>('/api/v1/auth/email-otp/verify', {
        method: 'POST',
        body: { email, code },
      });
      finish(data);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  if (step === 'code') {
    return (
      <CodeStep
        destination={email}
        onVerify={(code) => void verify(code)}
        onResend={() => void send()}
        onBack={() => setStep('email')}
        resendIn={resendIn}
        pending={pending}
        error={error}
      />
    );
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <p className="text-fg-muted text-sm">
        Employers can sign in with a one-time code sent to their email.
      </p>
      <FormField label="Work email" required error={error ?? undefined}>
        <Input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          startAdornment={<Mail aria-hidden="true" />}
          autoFocus
        />
      </FormField>
      <Button type="submit" fullWidth loading={pending} disabled={!email.includes('@')}>
        Email me a code
      </Button>
      <Button
        variant="link"
        leftIcon={<ArrowLeft />}
        onClick={onBack}
        className="justify-self-start"
      >
        Use my password instead
      </Button>
    </form>
  );
}

function StaffSignIn({ next, onBack }: { next: string | null; onBack: () => void }) {
  const finish = useFinishSignIn(next);
  const [mode, setMode] = useState<'password' | 'two_factor' | 'email_code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mode === 'two_factor')
    return <AuthenticatorStep onDone={finish} onBack={() => setMode('password')} />;
  if (mode === 'email_code')
    return <EmailCodeSignIn next={next} onBack={() => setMode('password')} />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await apiFetch<SignedIn | TwoFactorRequired>('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      if (data.kind === 'two_factor_required') {
        setPassword('');
        setPending(false);
        setMode('two_factor');
        return;
      }
      finish(data);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <div className="grid gap-4">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 text-sm"
        style={{ color: 'var(--fg-muted)' }}
      >
        <ArrowLeft className="size-4" />
        Change role
      </button>
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <FormField label="Email" required>
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            startAdornment={<Mail aria-hidden="true" />}
          />
        </FormField>
        <FormField label="Password" required>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            startAdornment={<Lock aria-hidden="true" />}
          />
        </FormField>
        <div className="-mt-2 text-end text-sm">
          <NextLink
            href="/forgot-password"
            className="text-accent focus-visible:focus-ring rounded-sm underline-offset-4 hover:underline"
          >
            Forgot password?
          </NextLink>
        </div>
        <Alert message={error} />
        <Button type="submit" fullWidth loading={pending} disabled={!email || !password}>
          Sign in
        </Button>
        <Button
          variant="link"
          onClick={() => setMode('email_code')}
          className="justify-self-center"
        >
          Employer? Email me a sign-in code instead
        </Button>
      </form>
    </div>
  );
}

// ─── Role selector ─────────────────────────────────────────────────────

type RoleType = 'applicant' | 'employer' | 'staff';

const ROLE_CARDS: {
  id: RoleType;
  icon: typeof UserRound;
  label: string;
  desc: string;
  color: string;
  bg: string;
  border: string;
}[] = [
  {
    id: 'applicant',
    icon: UserRound,
    label: 'Job Seeker',
    desc: 'Sign in with your mobile number to access your profile and job matches.',
    color: '#0d7a3e',
    bg: 'rgba(13,122,62,0.07)',
    border: 'rgba(13,122,62,0.2)',
  },
  {
    id: 'employer',
    icon: Briefcase,
    label: 'Employer',
    desc: 'Sign in to manage your company listings and applicant pipeline.',
    color: '#1a5fac',
    bg: 'rgba(26,95,172,0.07)',
    border: 'rgba(26,95,172,0.2)',
  },
  {
    id: 'staff',
    icon: Shield,
    label: 'Staff / Admin',
    desc: 'Branch staff, verifiers, and administrators sign in here.',
    color: '#7c3a0d',
    bg: 'rgba(180,83,9,0.07)',
    border: 'rgba(180,83,9,0.2)',
  },
];

function RoleSelector({ onSelect }: { onSelect: (role: RoleType) => void }) {
  return (
    <div className="grid gap-3">
      <p className="text-fg-muted text-sm">Choose your role to continue:</p>
      {ROLE_CARDS.map((card) => {
        const Icon = card.icon;
        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelect(card.id)}
            className="group flex items-center gap-4 rounded-2xl border p-4 text-left transition-all hover:scale-[1.01]"
            style={{
              background: card.bg,
              borderColor: card.border,
            }}
          >
            <span
              className="grid size-11 shrink-0 place-items-center rounded-xl transition-colors"
              style={{ background: card.color + '18' }}
              aria-hidden="true"
            >
              <Icon className="size-5" style={{ color: card.color }} />
            </span>
            <div className="grid gap-0.5">
              <span className="text-fg text-sm font-semibold">{card.label}</span>
              <span className="text-fg-muted text-xs leading-relaxed">{card.desc}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function LoginForm({ next }: { next: string | null }) {
  const [role, setRole] = useState<RoleType | null>(null);

  if (!role) {
    return <RoleSelector onSelect={setRole} />;
  }

  if (role === 'applicant') {
    return <PhoneSignIn next={next} onBack={() => setRole(null)} />;
  }

  // employer and staff both use email/password (with different secondary options)
  return <StaffSignIn next={next} onBack={() => setRole(null)} />;
}
