'use client';

import {
  ArrowLeft,
  Briefcase,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Shield,
  UserRound,
} from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Checkbox, Input } from '@/components/atoms';
import { ErrorBanner, FormField, OTPInput, PhoneInput } from '@/components/molecules';
import { ApiClientError, apiFetch, safeNextPath } from '@/lib/api/client';
import { formatPkMobileDisplay } from '@/lib/format/phone';
import { TwoFactorSetup } from '@/app/(dashboard)/account/security/TwoFactorSetup';

interface SignedIn {
  kind: 'signed_in';
  homePath: string;
}
interface TwoFactorRequired {
  kind: 'two_factor_required';
  methods: string[];
  /** False only when the server could not resolve the account. */
  trustDeviceAllowed: boolean;
}
interface TwoFactorSetupRequired {
  kind: 'two_factor_setup_required';
  setupToken: string;
  expiresInSeconds: number;
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

function fieldError(error: unknown, path: string): string | undefined {
  return error instanceof ApiClientError ? error.issueFor(path) : undefined;
}

function useFinishSignIn(next: string | null) {
  const router = useRouter();
  return (result: SignedIn) => {
    router.replace(safeNextPath(next) ?? result.homePath);
    router.refresh();
  };
}

function Alert({ error, operation = 'Sign in' }: { error: unknown; operation?: string }) {
  if (error == null) return null;
  return <ErrorBanner error={error} operation={operation} />;
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
  error: unknown;
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
      <Alert error={error} />
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
  const [error, setError] = useState<unknown>(null);
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
      setError(err);
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
      setError(err);
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
          error={fieldError(error, 'phone')}
          hint="New here? Your account is created when you verify."
        >
          <PhoneInput autoFocus onChange={(change) => setPhone(change.e164)} />
        </FormField>
        <ErrorBanner error={error ?? undefined} operation="Send sign-in code" />
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
  trustDeviceAllowed,
}: {
  onDone: (result: SignedIn) => void;
  onBack: () => void;
  trustDeviceAllowed: boolean;
}) {
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // The code field submits itself on the 6th digit. Keep the checkbox in a ref
  // so that submit reads the box the user just ticked, not a stale render.
  const trustRef = useRef(false);
  trustRef.current = trustDeviceAllowed && trustDevice;

  const verify = async (value?: string) => {
    setPending(true);
    setError(null);
    try {
      const trust = trustRef.current;
      const body = useBackup
        ? { backupCode: backupCode.trim(), trustDevice: trust }
        : { code: value ?? code, trustDevice: trust };
      const { data } = await apiFetch<SignedIn>('/api/v1/auth/2fa/verify', {
        method: 'POST',
        body,
      });
      onDone(data);
    } catch (err) {
      setError(err);
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
      <Checkbox
        label="Trust this device for 30 days"
        checked={trustDevice}
        onCheckedChange={(v) => {
          const next = v === true;
          trustRef.current = trustDeviceAllowed && next;
          setTrustDevice(next);
        }}
        disabled={!trustDeviceAllowed}
      />
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
      <Alert error={error} />
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

function StaffSignIn({ next, onBack }: { next: string | null; onBack: () => void }) {
  const finish = useFinishSignIn(next);
  const [mode, setMode] = useState<'password' | 'two_factor' | 'two_factor_setup'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [trustDeviceAllowed, setTrustDeviceAllowed] = useState(true);
  const [setupToken, setSetupToken] = useState<string | null>(null);

  if (mode === 'two_factor')
    return (
      <AuthenticatorStep
        onDone={finish}
        onBack={() => setMode('password')}
        trustDeviceAllowed={trustDeviceAllowed}
      />
    );
  if (mode === 'two_factor_setup' && setupToken)
    return (
      <div className="grid gap-4">
        <p className="text-fg-muted text-sm">
          Your role requires two-factor authentication. Set it up now to finish signing in — this
          setup link expires in 15 minutes.
        </p>
        <TwoFactorSetup required setupToken={setupToken} />
        <Button
          variant="secondary"
          leftIcon={<ArrowLeft />}
          onClick={() => setMode('password')}
          className="justify-self-start"
        >
          Back to sign-in
        </Button>
      </div>
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await apiFetch<SignedIn | TwoFactorRequired | TwoFactorSetupRequired>(
        '/api/v1/auth/login',
        {
          method: 'POST',
          body: { email, password },
        },
      );
      if (data.kind === 'two_factor_required') {
        setPassword('');
        setPending(false);
        setTrustDeviceAllowed(data.trustDeviceAllowed);
        setMode('two_factor');
        return;
      }
      if (data.kind === 'two_factor_setup_required') {
        // Audit H-02: no session was issued — the setup token is the only
        // way forward, and it only starts enrolment.
        setPassword('');
        setPending(false);
        setSetupToken(data.setupToken);
        setMode('two_factor_setup');
        return;
      }
      finish(data);
    } catch (err) {
      setError(err);
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
            type={showPw ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            startAdornment={<Lock aria-hidden="true" />}
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
        <div className="-mt-2 text-end text-sm">
          <NextLink
            href="/forgot-password"
            className="text-accent focus-visible:focus-ring rounded-sm underline-offset-4 hover:underline"
          >
            Forgot password?
          </NextLink>
        </div>
        <Alert error={error} />
        <Button type="submit" fullWidth loading={pending} disabled={!email || !password}>
          Sign in
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
