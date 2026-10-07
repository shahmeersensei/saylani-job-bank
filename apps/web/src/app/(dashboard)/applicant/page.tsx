import type { ProfileSectionId } from '@jobbank/shared';
import {
  ArrowRight,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Circle,
  FileText,
  MapPin,
  Star,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import NextLink from 'next/link';
import { Button, StatusPill } from '@/components/atoms';
import { StatCard } from '@/components/molecules/StatCard';
import { getMyProfile } from '@/domains/applicant';
import { requireRole } from '@/domains/auth';
import { formatPkMobileDisplay } from '@/lib/format/phone';
import { APPLICANT_STATUS_PILL, IDENTITY_PILL } from '../_components/applicants/labels';
import { StatusToggle } from './_components/StatusToggle';

export const metadata = { title: 'My Dashboard — Saylani Job Bank' };

const STEP_FOR: Record<ProfileSectionId, string> = {
  personal: 'personal',
  location: 'location',
  skills: 'skills',
  languages: 'skills',
  education: 'education',
  experience: 'experience',
  preferences: 'preferences',
  documents: 'documents',
};

export default async function ApplicantHomePage() {
  const { actor, user } = await requireRole('APPLICANT');
  const profile = await getMyProfile(actor);

  /* ── Empty state ─────────────────────────────────────────── */
  if (!profile) {
    return (
      <div className="grid w-full gap-8">
        <header className="grid gap-1">
          <h1 className="text-fg text-2xl font-bold">
            Welcome to <span style={{ color: 'var(--primary)' }}>Saylani Job Bank</span>
          </h1>
          <p className="text-fg-muted text-sm">
            Signed in as {user.phoneNumber ? formatPkMobileDisplay(user.phoneNumber) : user.name}.
          </p>
        </header>

        <div
          className="rounded-2xl border p-8"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="grid gap-5">
            <div>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold"
                style={{
                  borderColor: 'var(--primary)',
                  background: 'var(--primary-soft)',
                  color: 'var(--primary-soft-fg)',
                }}
              >
                Get Started
              </span>
            </div>
            <h2 className="text-fg text-2xl font-bold">Create your job seeker profile</h2>
            <p className="text-fg-muted text-sm leading-relaxed">
              Tell us about yourself, where you live and what work you can do. We match you with
              verified employers near your home, and arrange interviews through your Job Bank
              branch. Employers never see your phone number, CNIC or address.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { step: '1', label: 'Personal details' },
                { step: '2', label: 'Home location' },
                { step: '3', label: 'Skills & education' },
                { step: '4', label: 'CNIC photos' },
              ].map((s) => (
                <div
                  key={s.step}
                  className="rounded-xl border p-3 text-center"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--surface-muted)',
                  }}
                >
                  <div
                    className="mx-auto mb-1.5 grid size-7 place-items-center rounded-full text-xs font-bold"
                    style={{ background: 'var(--primary)', color: '#fff' }}
                  >
                    {s.step}
                  </div>
                  <p className="text-fg-muted text-xs leading-snug">{s.label}</p>
                </div>
              ))}
            </div>
            <div>
              <Button asChild rightIcon={<ArrowRight />} className="mt-1">
                <NextLink href="/applicant/profile">Start my profile</NextLink>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Dashboard ───────────────────────────────────────────── */
  const { completeness } = profile;
  const missingForActivation = completeness.sections.filter((s) =>
    completeness.activationMissing.includes(s.id),
  );
  const firstName = profile.personal.fullName.split(/\s+/)[0];

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-PK', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="grid w-full gap-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-fg-muted text-sm">{dateStr}</p>
          <h1 className="text-fg text-2xl font-bold sm:text-3xl">
            Welcome back, <span style={{ color: 'var(--primary)' }}>{firstName}</span> 👋
          </h1>
          <p className="text-fg-muted text-sm">
            Track your applications, manage your profile and discover jobs near you.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill {...APPLICANT_STATUS_PILL[profile.status]} />
          <StatusPill {...IDENTITY_PILL[profile.identityStatus]} />
          <Button asChild variant="secondary" leftIcon={<UserRound />} size="sm">
            <NextLink href="/applicant/profile">Edit profile</NextLink>
          </Button>
          <Button asChild variant="secondary" leftIcon={<FileText />} size="sm">
            <NextLink href="/applicant/documents">Documents</NextLink>
          </Button>
        </div>
      </div>

      {/* ── KPI tiles ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Profile Complete"
          value={`${completeness.percent}%`}
          icon={UserRound}
          tone="green"
          sub="Fill all sections"
          spark={[20, 35, 50, 60, 65, 70, 80, completeness.percent]}
        />
        <StatCard
          label="Applications"
          value="—"
          icon={Briefcase}
          tone="blue"
          sub="In pipeline (M10)"
        />
        <StatCard label="Interviews" value="—" icon={Calendar} tone="amber" sub="Upcoming (M11)" />
        <StatCard
          label="Job Matches"
          value="—"
          icon={MapPin}
          tone="teal"
          sub="Near your area (M9)"
        />
      </div>

      {/* ── Status alerts ────────────────────────────────────── */}
      {profile.status === 'DRAFT' && missingForActivation.length > 0 && (
        <section
          aria-label="Profile incomplete"
          className="grid gap-3 rounded-2xl px-5 py-4 text-sm"
          style={{
            background: 'var(--warning-soft)',
            color: 'var(--warning-soft-fg)',
            border: '1px solid rgba(180,83,9,0.15)',
          }}
        >
          <p className="font-semibold">Your profile is not live yet.</p>
          <p>Complete these sections to start getting matched with jobs:</p>
          <ul className="grid list-disc gap-1 pl-4">
            {missingForActivation.map((s) => (
              <li key={s.id}>
                <NextLink
                  className="font-medium underline underline-offset-4"
                  href={`/applicant/profile?step=${STEP_FOR[s.id]}`}
                >
                  {s.label}
                </NextLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.status === 'ACTIVE' && (
        <div
          className="flex items-center gap-3 rounded-2xl px-5 py-4 text-sm font-medium"
          style={{
            background: 'var(--success-soft)',
            color: 'var(--success-soft-fg)',
            border: '1px solid rgba(21,128,61,0.15)',
          }}
        >
          <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
          Your profile is live. Job Bank staff can now match you with verified jobs near your home.
        </div>
      )}

      {profile.status === 'INACTIVE' && (
        <p
          className="rounded-2xl px-5 py-4 text-sm"
          style={{ background: 'var(--neutral-soft)', color: 'var(--fg-muted)' }}
        >
          Your profile is paused — you are not suggested for new jobs.
        </p>
      )}

      {/* ── Main grid ────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        {/* Profile completeness card */}
        <section
          className="rounded-2xl border p-6"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-fg text-base font-bold">Profile Completeness</h2>
            <span
              className="numeric rounded-full px-3 py-1 text-sm font-bold"
              style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-fg)' }}
            >
              {completeness.percent}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="mb-5 grid gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-fg-muted text-xs">
                A complete profile gets better job matches
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Profile completeness"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={completeness.percent}
              className="h-3 overflow-hidden rounded-full"
              style={{ background: 'var(--surface-sunken)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${completeness.percent}%`,
                  background: 'linear-gradient(90deg, var(--primary) 0%, #34c76b 100%)',
                }}
              />
            </div>
          </div>

          <ul className="grid gap-0.5">
            {completeness.sections.map((s) => (
              <li key={s.id}>
                <NextLink
                  href={`/applicant/profile?step=${STEP_FOR[s.id]}`}
                  className="hover:bg-surface-muted flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-150"
                >
                  {s.done ? (
                    <CheckCircle2
                      className="size-5 shrink-0"
                      style={{ color: 'var(--primary)' }}
                      aria-hidden="true"
                    />
                  ) : (
                    <Circle className="text-fg-subtle size-5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="text-fg flex-1 font-medium">{s.label}</span>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    style={
                      s.done
                        ? { background: 'var(--success-soft)', color: 'var(--success-soft-fg)' }
                        : { background: 'var(--neutral-soft)', color: 'var(--fg-muted)' }
                    }
                  >
                    {s.done ? 'Done' : 'Add'}
                  </span>
                </NextLink>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid content-start gap-6">
          {/* Branch info card */}
          <section
            className="rounded-2xl border p-6"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--border)',
            }}
          >
            <h2 className="text-fg mb-4 text-base font-bold">Your Job Bank Branch</h2>
            {profile.branch ? (
              <div className="grid gap-3">
                <div
                  className="relative flex items-start gap-3 overflow-hidden rounded-2xl p-4"
                  style={{
                    background:
                      'linear-gradient(135deg, var(--primary-soft) 0%, var(--surface-muted) 100%)',
                  }}
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-4 -right-4 size-16 rounded-full opacity-30 blur-xl"
                    style={{ background: 'var(--primary)' }}
                  />
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-xl"
                    style={{ background: 'var(--primary)' }}
                    aria-hidden="true"
                  >
                    <Building2 className="size-5" style={{ color: '#fff' }} />
                  </span>
                  <div className="grid gap-0.5">
                    <span className="text-sm font-bold" style={{ color: 'var(--primary-soft-fg)' }}>
                      {profile.branch.name}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                      {profile.branch.address}
                    </span>
                    {profile.branch.phone && (
                      <span className="text-xs font-medium" style={{ color: 'var(--primary)' }}>
                        {profile.branch.phone}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <div
                  className="grid size-12 place-items-center rounded-2xl"
                  style={{ background: 'var(--primary-soft)' }}
                >
                  <MapPin
                    className="size-6"
                    style={{ color: 'var(--primary)' }}
                    aria-hidden="true"
                  />
                </div>
                <p className="text-fg-muted text-sm leading-relaxed">
                  Choose your branch when you{' '}
                  <NextLink
                    className="font-semibold underline underline-offset-4"
                    style={{ color: 'var(--primary)' }}
                    href="/applicant/profile?step=location"
                  >
                    add your home location
                  </NextLink>
                  .
                </p>
              </div>
            )}
          </section>

          {/* Benefits card */}
          <section
            className="rounded-2xl border p-6"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--border)',
            }}
          >
            <h2 className="text-fg mb-4 text-base font-bold">Why Job Bank?</h2>
            <div className="grid gap-2.5">
              {[
                {
                  icon: Star,
                  label: 'Verified Employers',
                  desc: 'Every company is checked before posting',
                  color: '#b45309',
                },
                {
                  icon: TrendingUp,
                  label: 'Local Matches',
                  desc: 'Jobs within walking / commuting distance',
                  color: '#1a5fac',
                },
                {
                  icon: MapPin,
                  label: 'Privacy First',
                  desc: 'CNIC & contact never shared directly',
                  color: '#0d7a3e',
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 rounded-xl p-3"
                    style={{ background: 'var(--surface-muted)' }}
                  >
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-lg"
                      style={{ background: item.color + '18' }}
                      aria-hidden="true"
                    >
                      <Icon className="size-4" style={{ color: item.color }} />
                    </span>
                    <div>
                      <p className="text-fg text-sm font-semibold">{item.label}</p>
                      <p className="text-fg-muted text-xs">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Status toggle */}
          {(profile.status === 'ACTIVE' || profile.status === 'INACTIVE') && (
            <section
              className="rounded-2xl border p-6"
              style={{
                background: 'var(--surface)',
                borderColor: 'var(--border)',
              }}
            >
              <h2 className="text-fg mb-2 text-base font-bold">Looking for work?</h2>
              <p className="text-fg-muted mb-4 text-sm">
                Found a job, or need a break? Pause your profile and resume any time.
              </p>
              <StatusToggle status={profile.status} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
