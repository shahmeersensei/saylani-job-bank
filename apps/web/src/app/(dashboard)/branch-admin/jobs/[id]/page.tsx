import { requireRole } from '@/domains/auth';
import { getJobDetail } from '@/domains/job';
import { masterDataLabels } from '@/domains/settings';
import { NotFoundError } from '@/domains/shared/errors';
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
import {
  Award,
  Banknote,
  BookOpen,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  Globe,
  MapPin,
  ShieldCheck,
  Star,
  Users,
  Wrench,
} from 'lucide-react';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Job detail — Branch Admin' };

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

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-PK', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function PerkChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
      style={{
        background: 'var(--success-soft)',
        color: 'var(--success-soft-fg)',
        border: '1px solid rgba(21,128,61,0.15)',
      }}
    >
      <CheckCircle2 className="size-3" />
      {label}
    </span>
  );
}

import type React from 'react';

export default async function BranchAdminJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { actor } = await requireRole('BRANCH_ADMIN');
  const { id } = await params;

  try {
    const job = await getJobDetail(actor, id);
    const pill = STATUS_BADGE[job.status];

    // Fetch human-readable labels from master data
    const labels = await masterDataLabels(['EDUCATION_LEVEL', 'JOB_CATEGORY', 'LANGUAGE', 'SKILL']);
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
        {/* ── Header ─────────────────────────────────────────────── */}
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
              {catLabel(job.categoryCode)}
            </p>
          </div>
        </header>

        {/* ── Core details ───────────────────────────────────────── */}
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

        {/* ── Description ────────────────────────────────────────── */}
        <Section title="Description" icon={BookOpen}>
          <p
            className="text-sm leading-relaxed whitespace-pre-wrap"
            style={{ color: 'var(--fg-muted)' }}
          >
            {job.description}
          </p>
        </Section>

        {/* ── Location ───────────────────────────────────────────── */}
        {job.locations.length > 0 && (
          <Section title="Job Location" icon={MapPin}>
            <ul className="grid gap-3">
              {job.locations.map((loc) => (
                <li key={loc.id} className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--primary)' }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--fg)' }}>
                      {loc.addressLine}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                      {loc.cityCode}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── Requirements ───────────────────────────────────────── */}
        {job.requirements && (
          <Section title="Requirements" icon={Award}>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4">
              {job.requirements.educationLevelCode && (
                <KV
                  label="Minimum education"
                  icon={BookOpen}
                  value={eduLabel(job.requirements.educationLevelCode)}
                />
              )}
              {job.requirements.minExperienceYears != null &&
                job.requirements.minExperienceYears > 0 && (
                  <KV
                    label="Minimum experience"
                    icon={Star}
                    value={
                      job.requirements.minExperienceYears === 1
                        ? '1 year'
                        : `${job.requirements.minExperienceYears} years`
                    }
                  />
                )}
            </dl>

            {job.requirements.languageCodes.length > 0 && (
              <div className="mt-4">
                <p
                  className="mb-2 text-xs font-medium tracking-wide uppercase"
                  style={{ color: 'var(--fg-subtle)' }}
                >
                  Languages required
                </p>
                <div className="flex flex-wrap gap-2">
                  {job.requirements.languageCodes.map((code) => (
                    <span
                      key={code}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
                      style={{
                        background: 'var(--primary-soft)',
                        color: 'var(--primary-soft-fg)',
                      }}
                    >
                      <Globe className="size-3" />
                      {langLabel(code)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {job.requirements.otherRequirements && (
              <div className="mt-4">
                <p
                  className="mb-1 text-xs font-medium tracking-wide uppercase"
                  style={{ color: 'var(--fg-subtle)' }}
                >
                  Other requirements
                </p>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                  {job.requirements.otherRequirements}
                </p>
              </div>
            )}
          </Section>
        )}

        {/* ── Skills ─────────────────────────────────────────────── */}
        {job.skills.length > 0 && (
          <Section title="Skills Required" icon={Wrench}>
            <div className="flex flex-wrap gap-2">
              {job.skills.map((s) => (
                <span
                  key={s.skillCode}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
                  style={{
                    background: s.required ? 'var(--warning-soft)' : 'var(--surface-muted)',
                    color: s.required ? 'var(--warning-soft-fg)' : 'var(--fg-muted)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <Wrench className="size-3" />
                  {skillLabel(s.skillCode)}
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px]"
                    style={{
                      background: 'rgba(0,0,0,0.08)',
                    }}
                  >
                    {SKILL_LEVEL_LABELS[s.minLevel as SkillLevel]}
                  </span>
                  {s.required && <span className="text-[10px] font-semibold">Required</span>}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* ── Benefits & Perks ───────────────────────────────────── */}
        <Section title="Benefits & Perks" icon={ShieldCheck}>
          <dl className="mb-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            <KV
              label="Medical coverage"
              icon={ShieldCheck}
              value={MEDICAL_COVERAGE_LABELS[job.medicalCoverage as MedicalCoverageType]}
            />
            <KV
              label="Performance bonus"
              icon={Star}
              value={BONUS_TIER_LABELS[job.bonusTier as BonusTier]}
            />
            {job.annualLeaveDays != null && (
              <KV
                label="Annual leave"
                icon={Calendar}
                value={`${job.annualLeaveDays} days / year`}
              />
            )}
          </dl>

          {activePerks.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {activePerks.map((perk) => (
                <PerkChip key={perk} label={perk} />
              ))}
            </div>
          ) : (
            <p className="text-xs" style={{ color: 'var(--fg-subtle)' }}>
              No additional perks listed.
            </p>
          )}
        </Section>

        {/* ── Meta ───────────────────────────────────────────────── */}
        <Section title="Timeline" icon={Calendar}>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            <KV label="Created" icon={Calendar} value={formatDate(job.createdAt)} />
            {job.publishedAt && (
              <KV label="Published" icon={Calendar} value={formatDate(job.publishedAt)} />
            )}
            {job.closedAt && <KV label="Closed" icon={Calendar} value={formatDate(job.closedAt)} />}
            {job.reopenedAt && (
              <KV label="Reopened" icon={Calendar} value={formatDate(job.reopenedAt)} />
            )}
            {job.closesAt && (
              <KV label="Expires on" icon={Calendar} value={formatDate(job.closesAt)} />
            )}
            <KV label="Last updated" icon={Calendar} value={formatDate(job.updatedAt)} />
          </dl>
        </Section>
      </div>
    );
  } catch (e) {
    if (e instanceof NotFoundError) return notFound();
    throw e;
  }
}
