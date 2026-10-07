import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { StatusPill } from '@/components/atoms';
import { requireSignedIn, requiresTwoFactor } from '@/domains/auth';
import { TwoFactorSetup } from './TwoFactorSetup';
import { TwoFactorStatus } from './TwoFactorStatus';

export const metadata = { title: 'Security' };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const { user, actor } = await requireSignedIn({ allowTwoFactorPending: true });
  const required = requiresTwoFactor(actor.roles);
  const { setup } = await searchParams;

  return (
    <div className="grid w-full gap-6">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Security</h1>
        <p className="text-fg-muted text-sm">
          Protect your account with an authenticator app (two-factor authentication).
        </p>
      </header>

      {actor.twoFactorPending && setup === 'required' && (
        <div
          role="alert"
          className="border-warning bg-warning-soft text-warning-soft-fg flex gap-3 rounded-xl border p-4 text-sm"
        >
          <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            Your role ({actor.roles.includes('SUPER_ADMIN') ? 'Super Admin' : 'Branch Admin'})
            requires two-factor authentication. Set it up below to continue using the Job Bank.
          </p>
        </div>
      )}

      <section className="border-border bg-surface shadow-card grid gap-4 rounded-xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-fg flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="text-primary size-5" aria-hidden="true" /> Two-factor
            authentication
          </h2>
          <StatusPill
            label={user.twoFactorEnabled ? 'On' : 'Off'}
            tone={user.twoFactorEnabled ? 'success' : required ? 'warning' : 'neutral'}
          />
        </div>
        {user.twoFactorEnabled ? (
          <TwoFactorStatus canDisable={!required} />
        ) : (
          <TwoFactorSetup required={required} />
        )}
      </section>
    </div>
  );
}
