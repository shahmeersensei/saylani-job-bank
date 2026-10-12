import { Briefcase, MapPin, Star, TrendingUp, CheckCircle2, Clock, Banknote } from 'lucide-react';
import NextLink from 'next/link';
import { Button } from '@/components/atoms';
import { getMyProfile } from '@/domains/applicant';
import { requireRole } from '@/domains/auth';
import { listMatchedJobs, type MatchedJob, type MatchStrength } from '@/domains/matching';
import { JOB_TYPE_LABELS, SHIFT_TYPE_LABELS } from '@jobbank/shared';

export const metadata = { title: 'Job Matches — Saylani Job Bank' };

const STRENGTH_CONFIG: Record<
  MatchStrength,
  { label: string; bg: string; fg: string; border: string }
> = {
  GREAT: {
    label: 'Great Match',
    bg: 'var(--success-soft)',
    fg: 'var(--success-soft-fg)',
    border: 'rgba(21,128,61,0.2)',
  },
  GOOD: {
    label: 'Good Match',
    bg: 'var(--primary-soft)',
    fg: 'var(--primary-soft-fg)',
    border: 'rgba(26,95,172,0.2)',
  },
  POSSIBLE: {
    label: 'Possible Match',
    bg: 'var(--neutral-soft)',
    fg: 'var(--fg-muted)',
    border: 'var(--border)',
  },
};

function formatSalary(min: number | null, max: number | null): string {
  if (!min && !max) return 'Salary not disclosed';
  const fmt = (n: number) =>
    n >= 1000 ? `PKR ${Math.round(n / 1000)}k` : `PKR ${n.toLocaleString()}`;
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (max) return `Up to ${fmt(max)}`;
  return `From ${fmt(min!)}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function JobCard({ job }: { job: MatchedJob }) {
  const cfg = STRENGTH_CONFIG[job.strength];

  return (
    <div
      className="group rounded-2xl border p-5 transition-all duration-150 hover:shadow-md"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Header row */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-fg truncate text-base font-bold">{job.title}</h3>
        <span
          className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.border}` }}
        >
          {cfg.label}
        </span>
      </div>

      {/* Score bar */}
      <div className="mb-3">
        <div
          className="mb-1 flex items-center justify-between text-xs"
          style={{ color: 'var(--fg-muted)' }}
        >
          <span>Match score</span>
          <span className="font-semibold" style={{ color: 'var(--fg)' }}>
            {job.score}%
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full"
          style={{ background: 'var(--surface-sunken)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${job.score}%`,
              background:
                job.strength === 'GREAT'
                  ? 'linear-gradient(90deg,#15803d,#34c76b)'
                  : job.strength === 'GOOD'
                    ? 'linear-gradient(90deg,var(--primary),#60a5fa)'
                    : 'var(--fg-subtle)',
            }}
          />
        </div>
      </div>

      {/* Tags row */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ background: 'var(--surface-muted)', color: 'var(--fg-muted)' }}
        >
          {JOB_TYPE_LABELS[job.jobType] ?? job.jobType}
        </span>
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ background: 'var(--surface-muted)', color: 'var(--fg-muted)' }}
        >
          {SHIFT_TYPE_LABELS[job.shift as keyof typeof SHIFT_TYPE_LABELS] ?? job.shift}
        </span>
      </div>

      {/* Match reasons */}
      {job.matchReasons.length > 0 && (
        <div className="mb-3 flex flex-col gap-1">
          {job.matchReasons.slice(0, 3).map((r) => (
            <div
              key={r}
              className="flex items-center gap-1.5 text-xs"
              style={{ color: 'var(--success-soft-fg)' }}
            >
              <CheckCircle2 className="size-3 shrink-0" />
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div
        className="flex items-center justify-between gap-3 border-t pt-3 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)' }}
      >
        <div className="flex items-center gap-1">
          <Banknote className="size-3.5" />
          <span>{formatSalary(job.salaryMin, job.salaryMax)}</span>
        </div>
        {job.publishedAt && (
          <div className="flex items-center gap-1">
            <Clock className="size-3.5" />
            <span>{timeAgo(job.publishedAt)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default async function ApplicantJobsPage() {
  const { actor } = await requireRole('APPLICANT');
  const profile = await getMyProfile(actor);

  /* ── No profile ──────────────────────────────────────────────── */
  if (!profile) {
    return (
      <div className="grid w-full gap-6">
        <header>
          <h1 className="text-fg text-2xl font-bold">Job Matches</h1>
        </header>
        <div
          className="rounded-2xl border p-8 text-center"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <p className="text-fg-muted mb-4 text-sm">
            Create your profile first to see jobs matched to your skills and location.
          </p>
          <Button asChild>
            <NextLink href="/applicant/profile">Start my profile</NextLink>
          </Button>
        </div>
      </div>
    );
  }

  /* ── Profile incomplete / no location ────────────────────────── */
  if (!profile.address) {
    return (
      <div className="grid w-full gap-6">
        <header>
          <h1 className="text-fg text-2xl font-bold">Job Matches</h1>
        </header>
        <div
          className="rounded-2xl border p-8 text-center"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <MapPin className="mx-auto mb-3 size-10" style={{ color: 'var(--primary)' }} />
          <p className="text-fg mb-1 font-semibold">Add your home location</p>
          <p className="text-fg-muted mb-4 text-sm">We need your city to find jobs near you.</p>
          <Button asChild variant="secondary">
            <NextLink href="/applicant/profile?step=location">Add location</NextLink>
          </Button>
        </div>
      </div>
    );
  }

  const jobs = await listMatchedJobs(profile);

  const greatCount = jobs.filter((j) => j.strength === 'GREAT').length;
  const goodCount = jobs.filter((j) => j.strength === 'GOOD').length;

  return (
    <div className="grid w-full gap-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-fg text-2xl font-bold sm:text-3xl">Job Matches</h1>
          <p className="text-fg-muted text-sm">
            Open jobs in <strong>{profile.address.cityCode}</strong> matched to your profile
          </p>
        </div>
        {jobs.length > 0 && (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--fg-muted)' }}>
            {greatCount > 0 && (
              <span
                className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: 'var(--success-soft)', color: 'var(--success-soft-fg)' }}
              >
                {greatCount} great {greatCount === 1 ? 'match' : 'matches'}
              </span>
            )}
            {goodCount > 0 && (
              <span
                className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-fg)' }}
              >
                {goodCount} good {goodCount === 1 ? 'match' : 'matches'}
              </span>
            )}
            <span style={{ color: 'var(--fg-muted)' }}>{jobs.length} total</span>
          </div>
        )}
      </div>

      {/* ── Profile incomplete warning ────────────────────────────── */}
      {profile.status === 'DRAFT' && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--warning-soft)', color: 'var(--warning-soft-fg)' }}
        >
          Your profile is incomplete — complete it to get better matches and to appear in the Job
          Bank staff queue.{' '}
          <NextLink
            href="/applicant/profile"
            className="font-semibold underline underline-offset-4"
          >
            Complete profile
          </NextLink>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────── */}
      {jobs.length === 0 && (
        <div
          className="rounded-2xl border p-10 text-center"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div
            className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl"
            style={{ background: 'var(--primary-soft)' }}
          >
            <Briefcase className="size-7" style={{ color: 'var(--primary)' }} />
          </div>
          <h2 className="text-fg mb-2 text-lg font-bold">No open jobs in your city yet</h2>
          <p className="text-fg-muted text-sm leading-relaxed">
            We'll show jobs here as employers in <strong>{profile.address.cityCode}</strong> post
            new openings. Check back soon!
          </p>

          <div className="mt-6 grid grid-cols-3 gap-3 text-left">
            {[
              {
                icon: Star,
                label: 'Complete your profile',
                desc: 'More details = better matches when jobs appear',
                color: '#b45309',
              },
              {
                icon: TrendingUp,
                label: 'Add your skills',
                desc: "Employers see who's available for their specific roles",
                color: '#1a5fac',
              },
              {
                icon: MapPin,
                label: 'Set job preferences',
                desc: 'Tell us what type of work you want',
                color: '#0d7a3e',
              },
            ].map((tip) => {
              const Icon = tip.icon;
              return (
                <div
                  key={tip.label}
                  className="rounded-xl p-3"
                  style={{ background: 'var(--surface-muted)' }}
                >
                  <Icon className="mb-2 size-5" style={{ color: tip.color }} />
                  <p className="text-fg text-sm font-semibold">{tip.label}</p>
                  <p className="text-fg-muted mt-0.5 text-xs">{tip.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Job grid ─────────────────────────────────────────────── */}
      {jobs.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => (
            <JobCard key={job.jobId} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
