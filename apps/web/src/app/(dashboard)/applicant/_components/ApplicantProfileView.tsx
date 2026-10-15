'use client';

import {
  APPLICANT_STATUS_LABELS,
  GENDER_LABELS,
  IDENTITY_STATUS_LABELS,
  JOB_TYPE_LABELS,
  LANGUAGE_PROFICIENCY_LABELS,
  SHIFT_LABELS,
  SKILL_LEVEL_LABELS,
  type ProfileSectionId,
} from '@jobbank/shared';
import {
  AlertCircle,
  Award,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCheck,
  FileText,
  GraduationCap,
  Languages,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import NextLink from 'next/link';
import { Button, StatusPill } from '@/components/atoms';
import type { ApplicantDocumentType, ApplicantProfile } from '@/domains/applicant';
import { maskCnic } from '@/lib/format/cnic';
import { formatPkMobileDisplay } from '@/lib/format/phone';
import {
  APPLICANT_STATUS_PILL,
  DOCUMENT_STATUS_PILL,
  IDENTITY_PILL,
} from '../../_components/applicants/labels';
import type { ProfileLabels, ProfileLists } from '../../_components/applicants/lists';
import type { WizardStepId } from './wizard-steps';

export interface ApplicantProfileViewProps {
  profile: ApplicantProfile;
  labels: ProfileLabels;
  lists: ProfileLists;
  documentTypes: ApplicantDocumentType[];
  onEditSection: (stepId: WizardStepId) => void;
}

function calculateAge(dateOfBirth: string): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const today = new Date();
  let age = today.getFullYear() - y;
  const monthDiff = today.getMonth() + 1 - m;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d)) {
    age--;
  }
  return age;
}

function formatMonth(monthStr?: string | null): string {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-');
  if (!year || !month) return monthStr;
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function ApplicantProfileView({
  profile,
  labels,
  documentTypes,
  onEditSection,
}: ApplicantProfileViewProps) {
  const { personal, address, branch, completeness } = profile;
  const age = calculateAge(personal.dateOfBirth);

  // Latest headline
  const latestJob = profile.experience[0];
  const headline = latestJob
    ? `${latestJob.jobTitle} at ${latestJob.employerName}`
    : profile.hasNoExperience
      ? 'Entry-level Candidate · Ready for new opportunities'
      : profile.preferences?.categoryCodes[0]
        ? `Seeking ${labels.JOB_CATEGORY[profile.preferences.categoryCodes[0]] ?? 'job'} opportunities`
        : 'Registered Job Seeker';

  const cityName = address?.cityCode
    ? (labels.CITY[address.cityCode] ?? address.cityCode)
    : 'Pakistan';

  // Missing activation items
  const missingActivation = completeness.activationMissing;

  return (
    <div className="grid w-full gap-6 pb-12">
      {/* ── 1. Hero Profile Card (LinkedIn style) ────────────────── */}
      <div className="border-border bg-surface relative isolate overflow-hidden rounded-2xl border shadow-xs">
        {/* Banner */}
        <div
          className="h-32 w-full sm:h-44"
          style={{
            background: 'linear-gradient(135deg, #059669 0%, #047857 50%, #1e3a8a 100%)',
          }}
        >
          <div className="size-full bg-[radial-gradient(#ffffff22_1px,transparent_1px)] [background-size:16px_16px] opacity-30" />
        </div>

        <div className="px-6 pt-0 pb-6">
          <div className="-mt-14 mb-4 flex flex-col justify-between gap-4 sm:-mt-16 sm:flex-row sm:items-end">
            {/* Avatar */}
            <div className="border-surface bg-primary text-primary-fg flex size-24 shrink-0 items-center justify-center rounded-full border-4 text-3xl font-bold shadow-md select-none sm:size-28 sm:text-4xl">
              {personal.fullName
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="primary"
                leftIcon={<Pencil />}
                onClick={() => onEditSection('personal')}
              >
                Edit Profile
              </Button>
              <Button asChild variant="secondary" leftIcon={<FileText />}>
                <NextLink href="/applicant/documents">Documents</NextLink>
              </Button>
            </div>
          </div>

          {/* Name & Headline */}
          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-fg text-2xl font-bold tracking-tight sm:text-3xl">
                {personal.fullName}
              </h1>
              <StatusPill {...APPLICANT_STATUS_PILL[profile.status]} />
              <StatusPill {...IDENTITY_PILL[profile.identityStatus]} />
            </div>

            <p className="text-fg-muted text-sm font-medium">
              s/o {personal.fatherName} · {headline}
            </p>

            {/* Meta row */}
            <div className="text-fg-muted mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs sm:text-sm">
              <span className="flex items-center gap-1.5">
                <MapPin className="text-primary size-4 shrink-0" aria-hidden="true" />
                {cityName}
                {branch?.name ? ` · ${branch.name} Branch` : ''}
              </span>
              {personal.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone className="size-4 shrink-0 opacity-70" aria-hidden="true" />
                  {formatPkMobileDisplay(personal.phone)}
                </span>
              )}
              {personal.email && (
                <span className="flex items-center gap-1.5">
                  <Mail className="size-4 shrink-0 opacity-70" aria-hidden="true" />
                  {personal.email}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. Profile Completeness Progress ─────────────────────── */}
      <div className="border-border bg-surface rounded-2xl border p-5 shadow-xs">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="bg-primary-soft text-primary-soft-fg rounded-lg p-1.5">
              <Sparkles className="size-4" />
            </div>
            <div>
              <p className="text-fg text-sm font-semibold">Profile Completeness</p>
              <p className="text-fg-muted text-xs">
                {completeness.percent >= 100
                  ? 'Your profile is fully completed and ready for employer matching.'
                  : `${completeness.percent}% completed — complete remaining items for best match ranking.`}
              </p>
            </div>
          </div>
          <span className="text-primary text-sm font-bold">{completeness.percent}%</span>
        </div>

        {/* Progress Bar */}
        <div className="bg-surface-muted border-border/50 h-2.5 w-full overflow-hidden rounded-full border">
          <div
            className="bg-primary h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${Math.min(100, completeness.percent)}%` }}
          />
        </div>

        {/* Missing activation items warning */}
        {missingActivation.length > 0 && (
          <div className="bg-warning-soft text-warning-soft-fg mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs">
            <AlertCircle className="size-4 shrink-0" />
            <span>
              <strong>Activation needed:</strong> Please complete your{' '}
              {missingActivation.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onEditSection(id as WizardStepId)}
                  className="mx-1 font-bold underline hover:opacity-80"
                >
                  {id}
                </button>
              ))}{' '}
              to activate your profile for employer job placement.
            </span>
          </div>
        )}
      </div>

      {/* ── 3. Grid of Profile Sections (LinkedIn style) ────────── */}
      <div className="grid gap-6">
        {/* SECTION: Personal Details */}
        <section className="border-border bg-surface rounded-2xl border p-6 shadow-xs">
          <div className="border-border flex items-center justify-between gap-3 border-b pb-4">
            <div className="flex items-center gap-2.5">
              <div className="bg-surface-muted text-fg-muted rounded-xl p-2">
                <User className="size-5" />
              </div>
              <div>
                <h2 className="text-fg text-base font-bold sm:text-lg">Personal Details</h2>
                <p className="text-fg-muted text-xs">Identity information matching your CNIC</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Pencil />}
              onClick={() => onEditSection('personal')}
            >
              Edit
            </Button>
          </div>

          <div className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-fg-muted text-xs font-medium">Full Name</p>
              <p className="text-fg mt-0.5 text-sm font-semibold">{personal.fullName}</p>
            </div>
            <div>
              <p className="text-fg-muted text-xs font-medium">Father / Husband Name</p>
              <p className="text-fg mt-0.5 text-sm font-semibold">{personal.fatherName}</p>
            </div>
            <div>
              <p className="text-fg-muted text-xs font-medium">CNIC Number</p>
              <p className="text-fg mt-0.5 font-mono text-sm font-semibold">
                {maskCnic(personal.cnic)}
              </p>
            </div>
            <div>
              <p className="text-fg-muted text-xs font-medium">Date of Birth & Age</p>
              <p className="text-fg mt-0.5 text-sm font-semibold">
                {personal.dateOfBirth} ({age} years)
              </p>
            </div>
            <div>
              <p className="text-fg-muted text-xs font-medium">Gender</p>
              <p className="text-fg mt-0.5 text-sm font-semibold">
                {GENDER_LABELS[personal.gender] ?? personal.gender}
              </p>
            </div>
            <div>
              <p className="text-fg-muted text-xs font-medium">Identity Check</p>
              <p className="text-fg mt-0.5 text-sm font-semibold">
                {IDENTITY_STATUS_LABELS[profile.identityStatus]}
              </p>
            </div>
          </div>
        </section>

        {/* SECTION: Location & Branch */}
        <section className="border-border bg-surface rounded-2xl border p-6 shadow-xs">
          <div className="border-border flex items-center justify-between gap-3 border-b pb-4">
            <div className="flex items-center gap-2.5">
              <div className="bg-surface-muted text-fg-muted rounded-xl p-2">
                <MapPin className="size-5" />
              </div>
              <div>
                <h2 className="text-fg text-base font-bold sm:text-lg">Home Location & Branch</h2>
                <p className="text-fg-muted text-xs">Used for finding matched jobs near you</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Pencil />}
              onClick={() => onEditSection('location')}
            >
              Edit
            </Button>
          </div>

          <div className="grid gap-4 pt-5 sm:grid-cols-2">
            <div>
              <p className="text-fg-muted text-xs font-medium">City</p>
              <p className="text-fg mt-0.5 text-sm font-semibold">{cityName}</p>
            </div>
            <div>
              <p className="text-fg-muted text-xs font-medium">Assigned Saylani Branch</p>
              <p className="text-fg mt-0.5 text-sm font-semibold">
                {branch?.name ?? 'Branch assigned upon location save'}
              </p>
              {branch?.address && <p className="text-fg-muted mt-0.5 text-xs">{branch.address}</p>}
            </div>
            <div className="sm:col-span-2">
              <p className="text-fg-muted text-xs font-medium">Street Address</p>
              <p className="text-fg mt-0.5 text-sm font-semibold">
                {address?.addressLine || 'None provided (optional)'}
              </p>
            </div>
            {address?.location && (
              <div className="text-primary bg-primary-soft/50 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium sm:col-span-2">
                <CheckCircle2 className="size-4 shrink-0" />
                Home location pin is recorded for nearby radius job matching.
              </div>
            )}
          </div>
        </section>

        {/* SECTION: Work Experience */}
        <section className="border-border bg-surface rounded-2xl border p-6 shadow-xs">
          <div className="border-border flex items-center justify-between gap-3 border-b pb-4">
            <div className="flex items-center gap-2.5">
              <div className="bg-surface-muted text-fg-muted rounded-xl p-2">
                <Briefcase className="size-5" />
              </div>
              <div>
                <h2 className="text-fg text-base font-bold sm:text-lg">Work Experience</h2>
                <p className="text-fg-muted text-xs">Past and current employment history</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Pencil />}
              onClick={() => onEditSection('experience')}
            >
              Edit
            </Button>
          </div>

          <div className="pt-5">
            {profile.hasNoExperience ? (
              <div className="border-border rounded-xl border border-dashed p-4 text-center">
                <p className="text-fg-muted text-sm">
                  Marked as <strong>having no prior work experience</strong>. Open to entry-level
                  jobs.
                </p>
              </div>
            ) : profile.experience.length === 0 ? (
              <p className="text-fg-muted text-sm italic">No work experience listed yet.</p>
            ) : (
              <div className="grid gap-6">
                {profile.experience.map((job, idx) => (
                  <div key={idx} className="flex items-start gap-3.5">
                    <div className="bg-surface-muted text-primary mt-0.5 shrink-0 rounded-xl p-2.5">
                      <Briefcase className="size-5" />
                    </div>
                    <div className="grid flex-1 gap-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-fg text-base font-bold">{job.jobTitle}</h3>
                        {job.isCurrent && (
                          <span className="bg-primary-soft text-primary-soft-fg rounded-full px-2.5 py-0.5 text-xs font-semibold">
                            Current Job
                          </span>
                        )}
                      </div>
                      <p className="text-fg-muted text-sm font-medium">{job.employerName}</p>
                      <p className="text-fg-subtle text-xs">
                        {formatMonth(job.startMonth)} —{' '}
                        {job.isCurrent ? 'Present' : formatMonth(job.endMonth)}
                      </p>
                      {job.description && (
                        <p className="text-fg-muted mt-1 text-sm leading-relaxed whitespace-pre-line">
                          {job.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* SECTION: Education & Certifications */}
        <section className="border-border bg-surface rounded-2xl border p-6 shadow-xs">
          <div className="border-border flex items-center justify-between gap-3 border-b pb-4">
            <div className="flex items-center gap-2.5">
              <div className="bg-surface-muted text-fg-muted rounded-xl p-2">
                <GraduationCap className="size-5" />
              </div>
              <div>
                <h2 className="text-fg text-base font-bold sm:text-lg">
                  Education & Certifications
                </h2>
                <p className="text-fg-muted text-xs">
                  Degrees, schooling, diplomas and certificates
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Pencil />}
              onClick={() => onEditSection('education')}
            >
              Edit
            </Button>
          </div>

          <div className="grid gap-6 pt-5">
            {/* Education Items */}
            <div>
              <h3 className="text-fg mb-3 text-sm font-semibold">Degrees & Schooling</h3>
              {profile.education.length === 0 ? (
                <p className="text-fg-muted text-sm italic">No education records added yet.</p>
              ) : (
                <div className="grid gap-4">
                  {profile.education.map((edu, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <div className="bg-surface-muted text-fg-muted mt-0.5 shrink-0 rounded-lg p-2">
                        <GraduationCap className="size-4" />
                      </div>
                      <div>
                        <p className="text-fg text-sm font-bold">
                          {labels.EDUCATION_LEVEL[edu.levelCode] ?? edu.levelCode}
                          {edu.fieldOfStudy ? ` · ${edu.fieldOfStudy}` : ''}
                        </p>
                        <p className="text-fg-muted text-xs font-medium">{edu.institution}</p>
                        <p className="text-fg-subtle mt-0.5 text-xs">
                          {edu.isCurrent
                            ? 'Currently enrolled'
                            : edu.completionYear
                              ? `Graduated ${edu.completionYear}`
                              : ''}
                          {edu.grade ? ` · Grade: ${edu.grade}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Certifications Items */}
            {profile.certifications.length > 0 && (
              <div className="border-border border-t pt-4">
                <h3 className="text-fg mb-3 text-sm font-semibold">Certificates & Licenses</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {profile.certifications.map((cert, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <div className="bg-surface-muted text-fg-muted mt-0.5 shrink-0 rounded-lg p-2">
                        <Award className="size-4" />
                      </div>
                      <div>
                        <p className="text-fg text-sm font-bold">{cert.name}</p>
                        {cert.issuer && (
                          <p className="text-fg-muted text-xs font-medium">{cert.issuer}</p>
                        )}
                        <p className="text-fg-subtle mt-0.5 text-xs">
                          {formatMonth(cert.issuedMonth)}
                          {cert.expiresMonth ? ` — Expires ${formatMonth(cert.expiresMonth)}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* SECTION: Skills & Languages */}
        <section className="border-border bg-surface rounded-2xl border p-6 shadow-xs">
          <div className="border-border flex items-center justify-between gap-3 border-b pb-4">
            <div className="flex items-center gap-2.5">
              <div className="bg-surface-muted text-fg-muted rounded-xl p-2">
                <Languages className="size-5" />
              </div>
              <div>
                <h2 className="text-fg text-base font-bold sm:text-lg">Skills & Languages</h2>
                <p className="text-fg-muted text-xs">
                  Technical skills, trades and language fluencies
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Pencil />}
              onClick={() => onEditSection('skills')}
            >
              Edit
            </Button>
          </div>

          <div className="grid gap-6 pt-5">
            {/* Skills */}
            <div>
              <h3 className="text-fg mb-3 text-sm font-semibold">Key Skills</h3>
              {profile.skills.length === 0 ? (
                <p className="text-fg-muted text-sm italic">No skills listed yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  {profile.skills.map((skill, idx) => (
                    <div
                      key={idx}
                      className="border-border bg-surface-muted/60 flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs"
                    >
                      <span className="text-fg font-semibold">
                        {labels.SKILL[skill.skillCode] ?? skill.skillCode}
                      </span>
                      <span className="bg-surface text-fg-muted border-border rounded-md border px-1.5 py-0.5 text-[11px] font-medium">
                        {SKILL_LEVEL_LABELS[skill.level]}
                        {skill.years > 0 ? ` · ${skill.years}y` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Languages */}
            <div className="border-border border-t pt-4">
              <h3 className="text-fg mb-3 text-sm font-semibold">Languages</h3>
              {profile.languages.length === 0 ? (
                <p className="text-fg-muted text-sm italic">No languages listed yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  {profile.languages.map((lang, idx) => (
                    <div
                      key={idx}
                      className="border-border bg-surface-muted/60 flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs"
                    >
                      <span className="text-fg font-semibold">
                        {labels.LANGUAGE[lang.languageCode] ?? lang.languageCode}
                      </span>
                      <span className="text-fg-muted text-[11px] font-medium">
                        {LANGUAGE_PROFICIENCY_LABELS[lang.proficiency]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* SECTION: Job Preferences */}
        <section className="border-border bg-surface rounded-2xl border p-6 shadow-xs">
          <div className="border-border flex items-center justify-between gap-3 border-b pb-4">
            <div className="flex items-center gap-2.5">
              <div className="bg-surface-muted text-fg-muted rounded-xl p-2">
                <Sparkles className="size-5" />
              </div>
              <div>
                <h2 className="text-fg text-base font-bold sm:text-lg">Job Preferences</h2>
                <p className="text-fg-muted text-xs">
                  Salary expectations, shifts and desired roles
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Pencil />}
              onClick={() => onEditSection('preferences')}
            >
              Edit
            </Button>
          </div>

          <div className="grid gap-5 pt-5 sm:grid-cols-2">
            <div>
              <p className="text-fg-muted text-xs font-medium">Desired Job Categories</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {profile.preferences?.categoryCodes &&
                profile.preferences.categoryCodes.length > 0 ? (
                  profile.preferences.categoryCodes.map((catCode) => (
                    <span
                      key={catCode}
                      className="bg-primary-soft text-primary-soft-fg rounded-lg px-2.5 py-1 text-xs font-semibold"
                    >
                      {labels.JOB_CATEGORY[catCode] ?? catCode}
                    </span>
                  ))
                ) : (
                  <span className="text-fg-muted text-sm italic">Not specified</span>
                )}
              </div>
            </div>

            <div>
              <p className="text-fg-muted text-xs font-medium">Expected Minimum Salary</p>
              <p className="text-fg mt-1 text-sm font-semibold">
                {profile.preferences?.minSalaryPkr
                  ? `PKR ${profile.preferences.minSalaryPkr.toLocaleString()} / month`
                  : 'Open / Any salary'}
              </p>
            </div>

            <div>
              <p className="text-fg-muted text-xs font-medium">Available Shifts</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {profile.preferences?.shifts && profile.preferences.shifts.length > 0 ? (
                  profile.preferences.shifts.map((s) => (
                    <span
                      key={s}
                      className="bg-surface-muted text-fg border-border rounded-md border px-2 py-0.5 text-xs font-medium"
                    >
                      {SHIFT_LABELS[s] ?? s}
                    </span>
                  ))
                ) : (
                  <span className="text-fg-muted text-sm italic">Any shift</span>
                )}
              </div>
            </div>

            <div>
              <p className="text-fg-muted text-xs font-medium">Job Types</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {profile.preferences?.jobTypes && profile.preferences.jobTypes.length > 0 ? (
                  profile.preferences.jobTypes.map((t) => (
                    <span
                      key={t}
                      className="bg-surface-muted text-fg border-border rounded-md border px-2 py-0.5 text-xs font-medium"
                    >
                      {JOB_TYPE_LABELS[t] ?? t}
                    </span>
                  ))
                ) : (
                  <span className="text-fg-muted text-sm italic">Any job type</span>
                )}
              </div>
            </div>

            {profile.preferences?.willingRadiusM && (
              <div className="sm:col-span-2">
                <p className="text-fg-muted text-xs font-medium">Willing Travel Radius</p>
                <p className="text-fg mt-0.5 text-sm font-semibold">
                  Up to {profile.preferences.willingRadiusM / 1000} km from home
                </p>
              </div>
            )}
          </div>
        </section>

        {/* SECTION: Documents */}
        <section className="border-border bg-surface rounded-2xl border p-6 shadow-xs">
          <div className="border-border flex items-center justify-between gap-3 border-b pb-4">
            <div className="flex items-center gap-2.5">
              <div className="bg-surface-muted text-fg-muted rounded-xl p-2">
                <FileCheck className="size-5" />
              </div>
              <div>
                <h2 className="text-fg text-base font-bold sm:text-lg">Uploaded Documents</h2>
                <p className="text-fg-muted text-xs">
                  CNIC copies, resume and trade certifications
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Pencil />}
              onClick={() => onEditSection('documents')}
            >
              Manage
            </Button>
          </div>

          <div className="grid gap-3 pt-5 sm:grid-cols-2">
            {profile.documents.length === 0 ? (
              <p className="text-fg-muted text-sm italic sm:col-span-2">
                No documents uploaded yet. Please upload both sides of your CNIC for identity
                verification.
              </p>
            ) : (
              profile.documents.map((doc) => {
                const typeObj = documentTypes.find((t) => t.code === doc.typeCode);
                const typeLabel = typeObj?.label ?? doc.typeCode;
                const statusPill = DOCUMENT_STATUS_PILL[doc.status];
                return (
                  <div
                    key={doc.id}
                    className="border-border bg-surface-muted/40 flex items-center justify-between gap-3 rounded-xl border p-3 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <FileText className="text-primary size-5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-fg truncate font-bold">{typeLabel}</p>
                        <p className="text-fg-muted truncate text-[11px]">{doc.fileName}</p>
                      </div>
                    </div>
                    {statusPill ? (
                      <StatusPill {...statusPill} />
                    ) : (
                      <span className="bg-surface text-fg-muted border-border rounded-md border px-2 py-0.5 text-[11px]">
                        {doc.status}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
