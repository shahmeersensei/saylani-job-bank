import { requireRole } from '@/domains/auth';
import { getCompanyDetail } from '@/domains/company';
import { getJobDetail } from '@/domains/job';
import { masterDataLabels } from '@/domains/settings';
import { NotFoundError, ScopeViolationError } from '@/domains/shared/errors';
import { Badge } from '@/components/atoms';
import {
  BONUS_TIER_LABELS,
  GENDER_PREFERENCE_LABELS,
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  MEDICAL_COVERAGE_LABELS,
  SHIFT_TYPE_LABELS,
  type BonusTier,
  type GenderPreference,
  type JobStatus,
  type JobType,
  type MedicalCoverageType,
  type ShiftType,
  type SkillLevel,
} from '@jobbank/shared';
import { formatDate } from '@/lib/format/date';
import {
  ArrowLeft,
  Award,
  Banknote,
  BookOpen,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react';
import NextLink from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata = { title: 'Job detail' };

const STATUS_BADGE: Record<
  JobStatus,
  { tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info' }
> = {
  DRAFT: { tone: 'neutral' },
  OPEN: { tone: 'success' },
  PAUSED: { tone: 'warning' },
  FILLED: { tone: 'success' },
  CLOSED: { tone: 'neutral' },
  EXPIRED: { tone: 'danger' },
};

const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  EXPERT: 'Expert',
};

function KV({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number | null | undefined;
  icon?: React.ElementType;
}) {
  return (
    <div className="flex items-start gap-2">
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--fg-subtle)' }} />}
      <div className="grid min-w-0 gap-0.5">
        <dt
          className="text-xs font-medium tracking-wide uppercase"
          style={{ color: 'var(--fg-subtle)' }}
        >
          {label}
        </dt>
        <dd className="text-sm" style={{ color: 'var(--fg)' }}>
          {value ?? '—'}
        </dd>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <h2 className="text-fg mb-4 flex items-center gap-2 font-semibold">
        {Icon && <Icon className="size-4" style={{ color: 'var(--primary)' }} />}
        {title}
      </h2>
      {children}
    </div>
  );
}

function formatSalary(min: number | null, max: number | null) {
  if (min == null && max == null) return null;
  const fmt = (n: number) => `PKR ${n.toLocaleString('en-PK')}`;
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)} / month`;
  if (max != null) return `Up to ${fmt(max)} / month`;
  return `From ${fmt(min!)} / month`;
}

export default async function VerifierJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { actor } = await requireRole('VERIFIER');
  const { id } = await params;

  try {
    const job = await getJobDetail(actor, id);
    const [company, labels] = await Promise.all([
      getCompanyDetail(actor, job.companyId),
      masterDataLabels(['EDUCATION_LEVEL', 'JOB_CATEGORY', 'LANGUAGE', 'SKILL', 'CITY']),
    ]);
    const pill = STATUS_BADGE[job.status];
    const eduLabel = (code: string | null) =>
      code ? (labels['EDUCATION_LEVEL']?.[code] ?? code) : null;
    const catLabel = (code: string) => labels['JOB_CATEGORY']?.[code] ?? code;
    const langLabel = (code: string) => labels['LANGUAGE']?.[code] ?? code;
    const skillLabel = (code: string) =>
      labels['SKILL']?.[code] ??
      code
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
    const cityLabel = (code: string) => labels['CITY']?.[code] ?? code;
    const salary = formatSalary(job.salaryMin, job.salaryMax);
    const activePerks = [
      job.fuelAllowance && 'Fuel allowance',
      job.flexibleHours && 'Flexible hours',
      job.workFromHome && 'Work from home',
      job.providentFund && 'Provident fund',
      job.transportAllowance && 'Transport allowance',
      job.eobi && 'EOBI',
      job.lifeInsurance && 'Life insurance',
    ].filter(Boolean) as string[];

    return (
      <div className="grid w-full gap-6">
        <div>
          <NextLink
            href="/verifier/jobs"
            className="text-fg-muted mb-3 flex items-center gap-1 text-sm hover:underline"
          >
            <ArrowLeft className="size-4" />
            Back to jobs
          </NextLink>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={pill.tone}>{JOB_STATUS_LABELS[job.status]}</Badge>
                {job.publishedAt && (
                  <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                    Published {formatDate(job.publishedAt)}
                  </span>
                )}
                {job.closedAt && (
                  <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                    · Closed {formatDate(job.closedAt)}
                  </span>
                )}
              </div>
              <h1 className="text-fg text-2xl font-bold">{job.title}</h1>
              <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                {catLabel(job.categoryCode)} · {company.details.legalName}
              </p>
            </div>
          </header>
        </div>

        <Section title="Job Details" icon={Briefcase}>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            <KV
              label="Employment type"
              icon={Briefcase}
              value={JOB_TYPE_LABELS[job.jobType as JobType]}
            />
            <KV label="Shift" icon={Clock} value={SHIFT_TYPE_LABELS[job.shift as ShiftType]} />
            <KV
              label="Gender preference"
              icon={Users}
              value={GENDER_PREFERENCE_LABELS[job.genderPreference as GenderPreference]}
            />
            <KV
              label="Vacancies"
              icon={Users}
              value={`${job.vacanciesFilled} filled / ${job.vacancies} total`}
            />
            {salary && <KV label="Salary" icon={Banknote} value={salary} />}
            {job.closesAt && (
              <KV label="Closes on" icon={Calendar} value={formatDate(job.closesAt)} />
            )}
          </dl>
        </Section>

        <Section title="Description" icon={BookOpen}>
          <p
            className="text-sm leading-relaxed whitespace-pre-wrap"
            style={{ color: 'var(--fg-muted)' }}
          >
            {job.description}
          </p>
        </Section>

        {job.locations.length > 0 && (
          <Section title="Job Location" icon={MapPin}>
            <ul className="grid gap-3">
              {job.locations.map((loc) => (
                <li key={loc.id} className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--primary)' }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--fg)' }}>
                      {cityLabel(loc.cityCode)}
                    </p>
                    <p className="text-fg-muted text-sm">{loc.addressLine}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {job.requirements && (
          <Section title="Requirements" icon={Award}>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
              {job.requirements.educationLevelCode && (
                <KV
                  label="Minimum education"
                  value={eduLabel(job.requirements.educationLevelCode)}
                />
              )}
              {job.requirements.minExperienceYears != null &&
                job.requirements.minExperienceYears > 0 && (
                  <KV
                    label="Minimum experience"
                    value={
                      job.requirements.minExperienceYears === 1
                        ? '1 year'
                        : `${job.requirements.minExperienceYears} years`
                    }
                  />
                )}
              {job.requirements.languageCodes.length > 0 && (
                <KV
                  label="Languages"
                  value={job.requirements.languageCodes.map(langLabel).join(', ')}
                />
              )}
            </dl>
            {job.requirements.otherRequirements && (
              <p className="text-fg-muted mt-4 text-sm leading-relaxed whitespace-pre-wrap">
                {job.requirements.otherRequirements}
              </p>
            )}
          </Section>
        )}

        {job.skills.length > 0 && (
          <Section title="Skills Required" icon={Wrench}>
            <ul className="grid gap-2">
              {job.skills.map((s) => (
                <li key={s.skillCode} className="flex items-center justify-between text-sm">
                  <span style={{ color: 'var(--fg)' }}>{skillLabel(s.skillCode)}</span>
                  <span style={{ color: 'var(--fg-muted)' }}>
                    {SKILL_LEVEL_LABELS[s.minLevel]}
                    {s.required ? ' · Required' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Benefits & Perks" icon={ShieldCheck}>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            <KV
              label="Medical coverage"
              value={MEDICAL_COVERAGE_LABELS[job.medicalCoverage as MedicalCoverageType]}
            />
            <KV label="Performance bonus" value={BONUS_TIER_LABELS[job.bonusTier as BonusTier]} />
            {job.annualLeaveDays != null && (
              <KV label="Annual leave" value={`${job.annualLeaveDays} days / year`} />
            )}
          </dl>
          {activePerks.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {activePerks.map((perk) => (
                <span
                  key={perk}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    background: 'var(--success-soft)',
                    color: 'var(--success-soft-fg)',
                    border: '1px solid rgba(21,128,61,0.15)',
                  }}
                >
                  <CheckCircle2 className="size-3" />
                  {perk}
                </span>
              ))}
            </div>
          )}
        </Section>
      </div>
    );
  } catch (e) {
    if (e instanceof NotFoundError) return notFound();
    // Audit 2026-11-11 (M-29): a cross-city job URL throws ScopeViolationError
    // from assertCityAccess — send the user to /forbidden instead of the
    // default Next.js error screen.
    if (e instanceof ScopeViolationError) redirect('/forbidden');
    throw e;
  }
}
