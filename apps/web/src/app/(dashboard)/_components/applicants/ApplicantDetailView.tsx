'use client';

import {
  GENDER_LABELS,
  GENDERS,
  IDENTITY_METHOD_LABELS,
  IDENTITY_METHODS,
  JOB_TYPE_LABELS,
  LANGUAGE_PROFICIENCY_LABELS,
  SHIFT_LABELS,
  SKILL_LEVEL_LABELS,
  type Gender,
  type IdentityMethod,
  type IdentityOutcome,
} from '@jobbank/shared';
import {
  ArrowRightLeft,
  BadgeCheck,
  Briefcase,
  Pencil,
  Phone,
  Printer,
  Send,
  UserCheck,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Badge, Button, Input, RadioGroup, Select, Textarea } from '@/components/atoms';
import type { SelectOption } from '@/components/atoms';
import {
  CNICInput,
  ConfirmDialog,
  DateTimePicker,
  FormField,
  KeyValue,
  Modal,
  PhoneInput,
  toast,
} from '@/components/molecules';
import { DocumentList, Timeline } from '@/components/organisms';
import type { ApplicantStaffView } from '@/domains/applicant';
import type { StaffMatchedJob } from '@/domains/matching';
import type { ApplicationView } from '@/domains/placement';
import { ApiClientError, apiFetch, friendlyApiError } from '@/lib/api/client';
import { formatCnic } from '@/lib/format/cnic';
import { formatDate, formatDateTime } from '@/lib/format/date';
import { formatPkMobileDisplay } from '@/lib/format/phone';
import { errorMessage, toFieldErrors, type FieldErrors } from './form';
import { DOCUMENT_STATUS_PILL, IDENTITY_PILL } from './labels';
import { openDocument } from './open-document';
import { ApplicantPhoto } from './ApplicantPhoto';
import type { ProfileLabels } from './lists';
import {
  RecordOutcomeDialog,
  ReferToEmployerDialog,
  ScheduleInterviewDialog,
  UpdateInterviewDialog,
} from './InterviewDialogs';

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-border bg-surface shadow-card grid content-start gap-4 rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-fg text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const ageFrom = (dob: string) => {
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age;
};

const monthLabel = (month: string | null) =>
  month
    ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-PK', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

// ─── Identity check ────────────────────────────────────────────────────

function IdentityCheckDialog({ applicant }: { applicant: ApplicantStaffView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const alreadyVerified = applicant.identityStatus === 'VERIFIED';
  const [outcome, setOutcome] = useState<IdentityOutcome>(
    alreadyVerified ? 'REJECTED' : 'VERIFIED',
  );
  const [method, setMethod] = useState<IdentityMethod>('DOCUMENT_REVIEW');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const hasImages = ['CNIC_FRONT', 'CNIC_BACK'].every((t) =>
    applicant.documents.some((d) => d.typeCode === t),
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/api/v1/applicants/${applicant.id}/identity-verification`, {
        method: 'POST',
        body: { outcome, method, notes: notes || null },
      });
      toast.success(outcome === 'VERIFIED' ? 'Identity verified' : 'Identity check recorded');
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.issues.length) setErrors(toFieldErrors(err.issues));
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Record identity check"
      description={`Compare the CNIC with ${applicant.personal.fullName}'s details: CNIC ${formatCnic(applicant.personal.cnic)}, born ${formatDate(applicant.personal.dateOfBirth)}.`}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" leftIcon={<BadgeCheck />}>
          Check identity
        </Button>
      }
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <FormField label="Result" required>
          <RadioGroup
            aria-label="Result"
            orientation="horizontal"
            value={outcome}
            onValueChange={(v) => setOutcome(v as IdentityOutcome)}
            options={[
              {
                value: 'VERIFIED',
                label: 'Details match — verified',
                disabled: alreadyVerified,
                description: alreadyVerified ? 'Already verified.' : undefined,
              },
              { value: 'REJECTED', label: 'Does not match' },
            ]}
          />
        </FormField>
        <FormField label="How did you check?" required>
          <RadioGroup
            aria-label="How did you check?"
            value={method}
            onValueChange={(v) => setMethod(v as IdentityMethod)}
            options={IDENTITY_METHODS.map((m) => ({
              value: m,
              label: IDENTITY_METHOD_LABELS[m],
              disabled: m === 'DOCUMENT_REVIEW' && !hasImages,
              description:
                m === 'DOCUMENT_REVIEW' && !hasImages
                  ? 'Both CNIC images are needed first.'
                  : undefined,
            }))}
          />
        </FormField>
        <FormField
          label={outcome === 'REJECTED' ? 'What is wrong?' : 'Notes'}
          required={outcome === 'REJECTED'}
          error={errors.notes}
          hint={
            outcome === 'REJECTED' ? 'The applicant sees this note, so they can fix it.' : undefined
          }
        >
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={saving}
            variant={outcome === 'REJECTED' ? 'danger' : 'primary'}
          >
            Save result
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Corrections, phone, transfer ──────────────────────────────────────

function EditDetailsDialog({ applicant }: { applicant: ApplicantStaffView }) {
  const router = useRouter();
  const p = applicant.personal;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    fullName: p.fullName,
    fatherName: p.fatherName,
    cnic: p.cnic,
    dateOfBirth: p.dateOfBirth,
    gender: p.gender as Gender,
    email: p.email ?? '',
    reason: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const set = (changes: Partial<typeof form>) => setForm((f) => ({ ...f, ...changes }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const original: Record<string, string | null> = { ...p, email: p.email ?? '' };
    const changed = Object.fromEntries(
      Object.entries(form).filter(([k, v]) => k !== 'reason' && v !== original[k]),
    );
    setSaving(true);
    try {
      await apiFetch(`/api/v1/applicants/${applicant.id}`, {
        method: 'PATCH',
        body: { ...changed, reason: form.reason },
      });
      toast.success('Details corrected');
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.issues.length) setErrors(toFieldErrors(err.issues));
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Correct personal details"
      description="Changing the CNIC, names or date of birth sends the profile back for a new identity check."
      open={open}
      onOpenChange={setOpen}
      size="lg"
      trigger={
        <Button variant="secondary" leftIcon={<Pencil />}>
          Correct details
        </Button>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
        <FormField label="Full name" required error={errors.fullName} className="sm:col-span-2">
          <Input value={form.fullName} onChange={(e) => set({ fullName: e.target.value })} />
        </FormField>
        <FormField
          label="Father's or husband's name"
          required
          error={errors.fatherName}
          className="sm:col-span-2"
        >
          <Input value={form.fatherName} onChange={(e) => set({ fatherName: e.target.value })} />
        </FormField>
        <FormField label="CNIC" required error={errors.cnic}>
          <CNICInput value={form.cnic} onChange={(c) => set({ cnic: c.digits })} />
        </FormField>
        <FormField label="Date of birth" required error={errors.dateOfBirth}>
          <DateTimePicker
            mode="date"
            value={form.dateOfBirth}
            onChange={(iso) => set({ dateOfBirth: iso })}
          />
        </FormField>
        <FormField label="Gender" required error={errors.gender}>
          <Select
            value={form.gender}
            onChange={(e) => set({ gender: e.target.value as Gender })}
            options={GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))}
          />
        </FormField>
        <FormField label="Email" error={errors.email}>
          <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </FormField>
        <FormField
          label="Reason for the correction"
          required
          error={errors.reason ?? errors['(root)']}
          hint="Recorded in the audit log."
          className="sm:col-span-2"
        >
          <Textarea
            rows={2}
            value={form.reason}
            onChange={(e) => set({ reason: e.target.value })}
          />
        </FormField>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save correction
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ChangePhoneDialog({ applicant }: { applicant: ApplicantStaffView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  // Audit 2026-11-11 (M-21): two steps. The new number must prove itself
  // with a 6-digit code texted to it before the profile moves — staff
  // say-so alone no longer marks the number verified.
  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await apiFetch<{ maskedPhone: string }>(
        `/api/v1/applicants/${applicant.id}/phone/code`,
        { method: 'POST', body: { phone } },
      );
      setMaskedPhone(data.maskedPhone);
      setErrors({});
      toast.success(`Verification code sent to ${data.maskedPhone}. It expires in 5 minutes.`);
    } catch (err) {
      if (err instanceof ApiClientError && err.issues.length) setErrors(toFieldErrors(err.issues));
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/api/v1/applicants/${applicant.id}/phone`, {
        method: 'PUT',
        body: { phone, reason, code },
      });
      toast.success('Mobile number changed. The applicant must sign in again.');
      setOpen(false);
      setCode('');
      setMaskedPhone(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.issues.length) setErrors(toFieldErrors(err.issues));
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Change mobile number"
      description="For account recovery (lost SIM, or a CNIC registered from another number). Check the original CNIC in person first. The old number is signed out."
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCode('');
          setMaskedPhone(null);
        }
      }}
      trigger={
        <Button variant="secondary" leftIcon={<Phone />}>
          Change mobile
        </Button>
      }
    >
      {maskedPhone === null ? (
        <form className="grid gap-4" onSubmit={sendCode} noValidate>
          <FormField label="New mobile number" required error={errors.phone}>
            <PhoneInput
              value={phone}
              onChange={(value) => setPhone(value.e164 ?? value.national)}
            />
          </FormField>
          <FormField
            label="Reason"
            required
            error={errors.reason}
            hint="Recorded in the audit log."
          >
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Send verification code
            </Button>
          </div>
        </form>
      ) : (
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <p className="text-fg-muted text-sm">
            A 6-digit code was sent to {maskedPhone}. Enter it below to move this profile to the new
            number.
          </p>
          <FormField label="Verification code" required error={errors.code}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
            />
          </FormField>
          <FormField
            label="Reason"
            required
            error={errors.reason}
            hint="Recorded in the audit log."
          >
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setMaskedPhone(null);
                setCode('');
              }}
              disabled={saving}
            >
              Edit number
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Change number
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

function TransferDialog({
  applicant,
  branches,
  listPath,
}: {
  applicant: ApplicantStaffView;
  branches: SelectOption[];
  listPath: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await apiFetch<{ branch: { name: string } }>(
        `/api/v1/applicants/${applicant.id}/transfer`,
        { method: 'POST', body: { branchId, expectedBranchId: applicant.branch?.id, reason } },
      );
      toast.success(`Moved to ${data.branch.name}`);
      setOpen(false);
      router.push(listPath);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.issues.length) setErrors(toFieldErrors(err.issues));
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Transfer to another branch"
      description="The new branch takes over this applicant. Your branch will no longer see the profile."
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="secondary" leftIcon={<ArrowRightLeft />}>
          Transfer
        </Button>
      }
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <FormField label="New branch" required error={errors.branchId}>
          <Select
            placeholder="Choose a branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            options={branches.filter((b) => b.value !== applicant.branch?.id)}
          />
        </FormField>
        <FormField label="Reason" required error={errors.reason} hint="Recorded in the audit log.">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Transfer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Shortlist dialog ──────────────────────────────────────────────────

function ShortlistDialog({
  applicant,
  openJobs,
}: {
  applicant: ApplicantStaffView;
  openJobs: SelectOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/v1/applications', {
        method: 'POST',
        body: { applicantId: applicant.id, jobId, note: note || undefined },
      });
      toast.success('Applicant shortlisted for the job');
      setOpen(false);
      setJobId('');
      setNote('');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.issues.length) setErrors(toFieldErrors(err.issues));
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Shortlist for a job"
      description={`Select an open job to shortlist ${applicant.personal.fullName} for.`}
      open={open}
      onOpenChange={setOpen}
      trigger={<Button leftIcon={<Briefcase />}>Shortlist for job</Button>}
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <FormField label="Job" required error={errors.jobId}>
          {openJobs.length === 0 ? (
            <p className="text-fg-muted text-sm">No open jobs found in this city.</p>
          ) : (
            <Select
              placeholder="Choose a job"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              options={openJobs}
            />
          )}
        </FormField>
        <FormField label="Note" hint="Optional note for staff reference." error={errors.note}>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!jobId}>
            Shortlist
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── AI-ranked jobs for referral ────────────────────────────────────────

const MATCH_STRENGTH: Record<
  StaffMatchedJob['strength'],
  { label: string; tone: 'success' | 'primary' | 'neutral' }
> = {
  GREAT: { label: 'Great match', tone: 'success' },
  GOOD: { label: 'Good match', tone: 'primary' },
  POSSIBLE: { label: 'Possible match', tone: 'neutral' },
};

function formatSalary(min: number | null, max: number | null) {
  if (min == null && max == null) return null;
  if (min != null && max != null)
    return `Rs ${min.toLocaleString('en-PK')} – ${max.toLocaleString('en-PK')}`;
  if (min != null) return `Rs ${min.toLocaleString('en-PK')}+`;
  return `Up to Rs ${max!.toLocaleString('en-PK')}`;
}

/**
 * Staff picks this applicant, then picks from their AI-ranked jobs.
 * Scores and reasons come straight from the matching engine's latest
 * completed run (skills, qualifications, experience, profile, distance) —
 * nothing is scored in the browser. Each row refers that one job to this
 * applicant via the existing job-referral API, so the applicant then sees
 * it on their Jobs page. Already-referred jobs stay visible, flagged,
 * instead of being offered again.
 *
 * Audit 2026-11-11 (M-14): ported from the fork clone's uncommitted
 * matched-jobs work.
 */
function MatchedJobsForReferralCard({
  applicantId,
  jobs,
}: {
  applicantId: string;
  jobs: StaffMatchedJob[];
}) {
  const [referredIds, setReferredIds] = useState<Set<string>>(
    () => new Set(jobs.filter((j) => j.referred).map((j) => j.jobId)),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReferredIds((prev) => {
      const next = new Set(prev);
      for (const j of jobs) if (j.referred) next.add(j.jobId);
      return next;
    });
  }, [jobs]);

  const refer = async (job: StaffMatchedJob) => {
    setError(null);
    setBusyId(job.jobId);
    try {
      await apiFetch(`/api/v1/jobs/${job.jobId}/applicant-referrals`, {
        method: 'POST',
        body: { applicantId },
      });
      setReferredIds((prev) => new Set(prev).add(job.jobId));
      toast.success(`“${job.title}” referred to this applicant.`);
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card title="Matched jobs — refer by AI ranking">
      <p className="text-fg-muted text-sm">
        Jobs ranked by the AI matching engine for this applicant — skills, qualifications,
        experience and profile. Pick a job to refer it to them; they will see it on their Jobs page
        and get a notification.
      </p>
      {error && (
        <p role="alert" className="bg-danger-soft text-danger-soft-fg rounded-lg px-4 py-3 text-sm">
          {error}
        </p>
      )}
      {jobs.length === 0 ? (
        <p className="text-fg-muted text-sm">
          No AI-matched jobs yet. Matches appear after the matching engine runs for a job — when a
          job is published or its matches are refreshed. If the list stays empty, the matching
          worker may not be running.
        </p>
      ) : (
        <ul className="grid gap-3">
          {jobs.map((job, index) => {
            const strength = MATCH_STRENGTH[job.strength];
            const referred = referredIds.has(job.jobId);
            const salary = formatSalary(job.salaryMin, job.salaryMax);
            return (
              <li key={job.jobId} className="border-border grid gap-2 rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid gap-0.5">
                    <span className="text-fg font-medium">
                      #{index + 1} · {job.title}
                    </span>
                    <span className="text-fg-muted text-sm">
                      {job.companyName ?? 'Company'}
                      {salary ? ` · ${salary}` : ''}
                    </span>
                    <span className="text-fg-muted text-xs">
                      {JOB_TYPE_LABELS[job.jobType as keyof typeof JOB_TYPE_LABELS] ?? job.jobType}
                      {' · '}
                      {SHIFT_LABELS[job.shift as keyof typeof SHIFT_LABELS] ?? job.shift}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={strength.tone}>{strength.label}</Badge>
                    <span className="numeric bg-primary-soft text-primary-soft-fg rounded-full px-3 py-1 text-sm font-bold">
                      {job.score}
                    </span>
                  </div>
                </div>
                {job.matchReasons.length > 0 && (
                  <p className="text-fg-muted text-sm">
                    {job.matchReasons.slice(0, 3).join(' · ')}
                  </p>
                )}
                <div>
                  <Button
                    variant="secondary"
                    loading={busyId === job.jobId}
                    disabled={referred || busyId !== null}
                    onClick={() => void refer(job)}
                  >
                    <Send className="mr-1.5 size-4" />
                    {referred ? 'Already referred' : 'Refer this job'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ─── Applications list ─────────────────────────────────────────────────

const APPLICATION_STATUS_LABELS: Record<
  string,
  { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' }
> = {
  SHORTLISTED: { label: 'Shortlisted', tone: 'info' },
  INTERVIEW_SCHEDULED: { label: 'Interview scheduled', tone: 'warning' },
  INTERVIEW_POSTPONED: { label: 'Postponed', tone: 'warning' },
  INTERVIEW_CANCELLED: { label: 'Interview cancelled', tone: 'neutral' },
  INTERVIEW_PASSED: { label: 'Interview passed', tone: 'success' },
  INTERVIEW_FAILED: { label: 'Interview failed', tone: 'danger' },
  FORWARDED: { label: 'Referred', tone: 'success' },
  EMPLOYER_INTERVIEW_SCHEDULED: { label: 'Employer interview', tone: 'warning' },
  EMPLOYER_INTERVIEW_POSTPONED: { label: 'Employer interview postponed', tone: 'warning' },
  EMPLOYER_INTERVIEW_CANCELLED: { label: 'Employer interview cancelled', tone: 'neutral' },
  ON_HOLD: { label: 'On hold', tone: 'warning' },
  OFFER_EXTENDED: { label: 'Offer extended', tone: 'success' },
  EMPLOYER_REJECTED: { label: 'Not selected by employer', tone: 'danger' },
  APPLICANT_REFUSED: { label: 'Offer refused', tone: 'neutral' },
  HIRED: { label: 'Hired', tone: 'success' },
  REJECTED: { label: 'Not progressed', tone: 'neutral' },
};

const INTERVIEW_STATUSES = new Set([
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_POSTPONED',
  'INTERVIEW_CANCELLED',
]);

/** Outcomes can be recorded only from a scheduled (or postponed) interview. */
const OUTCOME_STATUSES = new Set(['INTERVIEW_SCHEDULED', 'INTERVIEW_POSTPONED']);

function ApplicationsCard({
  applicant: _applicant,
  applications,
  canScheduleInterview,
  canReferToEmployer,
  canRecordInterviewOutcome,
  referPassedOnly,
}: {
  applicant: ApplicantStaffView;
  applications: ApplicationView[];
  /** True for staff/branch-admin; false for super-admin (read-only). */
  canScheduleInterview: boolean;
  canReferToEmployer: boolean;
  /** 0052 — holds interview:record_outcome (interviewer, staff, branch admin). */
  canRecordInterviewOutcome: boolean;
  /** 0052 — true for interviewer-only actors: refer is pass-only for them. */
  referPassedOnly: boolean;
}) {
  if (applications.length === 0) {
    return (
      <Card title="Applications">
        <p className="text-fg-muted text-sm">No applications yet.</p>
      </Card>
    );
  }

  return (
    <Card title="Applications">
      <ul className="grid gap-3">
        {applications.map((app) => {
          const pill = APPLICATION_STATUS_LABELS[app.status] ?? {
            label: app.status,
            tone: 'neutral' as const,
          };
          return (
            <li key={app.id} className="border-border grid gap-2 rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-fg font-medium">{app.jobTitle}</p>
                  <p className="text-fg-muted text-xs">{app.companyName}</p>
                </div>
                <Badge tone={pill.tone}>{pill.label}</Badge>
              </div>
              {app.interviewAt && (
                <p className="text-fg-muted text-xs">
                  Interview: {formatDateTime(app.interviewAt)}
                  {app.interviewLocation ? ` · ${app.interviewLocation}` : ''}
                </p>
              )}
              {app.interviewNote && <p className="text-fg-muted text-xs">{app.interviewNote}</p>}
              {app.interviewResult && (
                <p className="text-fg-muted text-xs">
                  Interview outcome: <span className="font-medium">{app.interviewResult}</span>
                  {app.interviewAttendance
                    ? ` · ${app.interviewAttendance === 'NO_SHOW' ? 'No-show' : 'Attended'}`
                    : ''}
                  {app.interviewFeedback ? ` — ${app.interviewFeedback}` : ''}
                </p>
              )}
              {app.employerInterviewAt && (
                <p className="text-fg-muted text-xs">
                  Employer interview: {formatDateTime(app.employerInterviewAt)}
                  {app.employerInterviewLocation ? ` · ${app.employerInterviewLocation}` : ''}
                </p>
              )}
              {app.employerDecision && (
                <p className="text-fg-muted text-xs">
                  Employer decision: <span className="font-medium">{app.employerDecision}</span>
                  {app.employerDecisionNote ? ` — ${app.employerDecisionNote}` : ''}
                </p>
              )}
              {app.applicantRefusalReason && (
                <p className="text-fg-muted text-xs">
                  Refusal reason: {app.applicantRefusalReason}
                </p>
              )}
              {app.note && <p className="text-fg-muted text-xs">Note: {app.note}</p>}
              {(canScheduleInterview || canReferToEmployer || canRecordInterviewOutcome) && (
                <div className="flex flex-wrap justify-end gap-2">
                  {canScheduleInterview && app.status === 'SHORTLISTED' && (
                    <ScheduleInterviewDialog applicationId={app.id} />
                  )}
                  {canScheduleInterview && INTERVIEW_STATUSES.has(app.status) && (
                    <UpdateInterviewDialog applicationId={app.id} />
                  )}
                  {canRecordInterviewOutcome && OUTCOME_STATUSES.has(app.status) && (
                    <RecordOutcomeDialog applicationId={app.id} />
                  )}
                  {canReferToEmployer &&
                    (referPassedOnly
                      ? app.status === 'INTERVIEW_PASSED'
                      : app.status === 'SHORTLISTED' ||
                        app.status === 'INTERVIEW_SCHEDULED' ||
                        app.status === 'INTERVIEW_POSTPONED' ||
                        app.status === 'INTERVIEW_PASSED') && (
                      <ReferToEmployerDialog
                        applicationId={app.id}
                        jobTitle={app.jobTitle}
                        companyName={app.companyName}
                      />
                    )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ─── Page body ─────────────────────────────────────────────────────────

export function ApplicantDetailView({
  applicant,
  labels,
  branches,
  openJobs,
  existingApplications,
  matchedJobs,
  canReferMatchedJobs,
  listPath,
}: {
  applicant: ApplicantStaffView;
  labels: ProfileLabels;
  branches: SelectOption[];
  openJobs?: SelectOption[];
  existingApplications?: ApplicationView[];
  matchedJobs?: StaffMatchedJob[];
  canReferMatchedJobs?: boolean;
  listPath: string;
}) {
  const router = useRouter();
  const p = applicant.personal;
  // The passport photo (PHOTO document), if one is on file — shown beside
  // the identity details instead of only as a row in the Documents list.
  const photo = applicant.documents.find((d) => d.typeCode === 'PHOTO') ?? null;
  const label = (type: keyof ProfileLabels, code: string | null) =>
    code ? (labels[type][code] ?? code) : null;
  const pref = applicant.preferences;
  const canChangeStatus =
    applicant.can.manage && (applicant.status === 'ACTIVE' || applicant.status === 'INACTIVE');

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap justify-end gap-2">
        {applicant.can.manage && (
          <Button asChild variant="primary" leftIcon={<Pencil />}>
            <Link href={`${listPath}/${applicant.id}/edit`}>Edit Profile</Link>
          </Button>
        )}
        {applicant.can.manage && (
          <Button asChild variant="secondary" leftIcon={<Printer />}>
            <Link href={`/print/applicants/${applicant.id}/registration`}>
              Print Registration Form
            </Link>
          </Button>
        )}
      </div>
      {applicant.status === 'INACTIVE' && applicant.statusReason && (
        <p className="bg-surface-muted text-fg-muted rounded-lg px-4 py-3 text-sm">
          Deactivated by staff: {applicant.statusReason}
        </p>
      )}
      {applicant.completeness.activationMissing.length > 0 && (
        <p className="bg-warning-soft text-warning-soft-fg rounded-lg px-4 py-3 text-sm">
          Profile incomplete. Still missing:{' '}
          {applicant.completeness.sections
            .filter((s) => applicant.completeness.activationMissing.includes(s.id))
            .map((s) => s.label.toLowerCase())
            .join(', ')}
          .
        </p>
      )}

      {applicant.can.shortlist && (
        <div className="flex flex-wrap gap-2">
          <ShortlistDialog applicant={applicant} openJobs={openJobs ?? []} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Identity"
          action={
            applicant.can.verifyIdentity ? <IdentityCheckDialog applicant={applicant} /> : undefined
          }
        >
          <div className="flex flex-wrap gap-4">
            <ApplicantPhoto
              applicantId={applicant.id}
              photo={photo}
              canManage={applicant.can.manage}
            />
            <div className="min-w-0 flex-1">
              <KeyValue
                items={[
                  { label: 'CNIC', value: <span className="numeric">{formatCnic(p.cnic)}</span> },
                  { label: "Father's / husband's name", value: p.fatherName },
                  {
                    label: 'Date of birth',
                    value: `${formatDate(p.dateOfBirth)} (age ${ageFrom(p.dateOfBirth)})`,
                  },
                  { label: 'Gender', value: GENDER_LABELS[p.gender] },
                  { label: 'Mobile', value: p.phone ? formatPkMobileDisplay(p.phone) : null },
                  { label: 'Email', value: p.email },
                ]}
              />
            </div>
          </div>
          <div className="border-border grid gap-3 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-fg-muted">Identity check:</span>
              <Badge tone={IDENTITY_PILL[applicant.identityStatus].tone}>
                {IDENTITY_PILL[applicant.identityStatus].label}
              </Badge>
            </div>
            {applicant.identityHistory.length > 0 && (
              <Timeline
                label="Identity check history"
                items={applicant.identityHistory.map((h) => ({
                  id: h.id,
                  title: `${h.outcome === 'VERIFIED' ? 'Verified' : 'Not verified'} · ${IDENTITY_METHOD_LABELS[h.method]}`,
                  description: [
                    h.notes,
                    h.cnicMatchesCurrent ? null : 'The CNIC was corrected after this check.',
                  ]
                    .filter(Boolean)
                    .join(' '),
                  timestamp: h.createdAt,
                  actor: h.verifiedByName ?? undefined,
                  tone: h.outcome === 'VERIFIED' ? 'success' : 'danger',
                }))}
              />
            )}
          </div>
        </Card>

        <Card title="Documents">
          <DocumentList
            label="Applicant documents"
            items={applicant.documents.map((d) => ({
              id: d.id,
              title: label('DOCUMENT_TYPE', d.typeCode) ?? d.typeCode,
              fileName: d.fileName,
              sizeBytes: d.sizeBytes,
              contentType: d.contentType,
              uploadedAt: d.uploadedAt,
              status: DOCUMENT_STATUS_PILL[d.status],
              note: d.reviewNote,
            }))}
            onView={(item) =>
              openDocument(`/api/v1/applicants/${applicant.id}/documents/${item.id}/url`)
            }
            empty={<p className="text-fg-muted text-sm">No documents uploaded yet.</p>}
          />
          <p className="text-fg-subtle text-xs">
            Every document you open is recorded in the audit log.
          </p>
        </Card>
      </div>

      <Card title="Home & branch">
        {applicant.address ? (
          <KeyValue
            columns={1}
            items={[
              { label: 'Address', value: applicant.address.addressLine },
              {
                label: 'Area',
                value: [
                  label('AREA', applicant.address.areaCode),
                  label('CITY', applicant.address.cityCode),
                ]
                  .filter(Boolean)
                  .join(', '),
              },
              { label: 'Branch', value: applicant.branch?.name },
              ...(applicant.address.location
                ? [
                    {
                      label: 'Coordinates',
                      value: `${applicant.address.location.lat.toFixed(4)}, ${applicant.address.location.lng.toFixed(4)}`,
                    },
                  ]
                : []),
            ]}
          />
        ) : (
          <p className="text-fg-muted text-sm">No home location yet.</p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Skills & languages">
          {applicant.skills.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Skills">
              {applicant.skills.map((s) => (
                <li key={s.skillCode}>
                  <Badge tone="accent">
                    {label('SKILL', s.skillCode)} · {SKILL_LEVEL_LABELS[s.level]}
                    {s.years ? ` · ${s.years} yr${s.years === 1 ? '' : 's'}` : ''}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-fg-muted text-sm">No skills added.</p>
          )}
          {applicant.languages.length > 0 && (
            <p className="text-fg text-sm">
              {applicant.languages
                .map(
                  (l) =>
                    `${label('LANGUAGE', l.languageCode)} (${LANGUAGE_PROFICIENCY_LABELS[l.proficiency].toLowerCase()})`,
                )
                .join(', ')}
            </p>
          )}
        </Card>

        <Card title="Job preferences">
          {pref ? (
            <KeyValue
              items={[
                {
                  label: 'Looking for',
                  value: pref.categoryCodes.map((c) => label('JOB_CATEGORY', c)).join(', '),
                  wide: true,
                },
                {
                  label: 'Minimum salary',
                  value: pref.minSalaryPkr
                    ? `Rs ${pref.minSalaryPkr.toLocaleString('en-PK')}`
                    : 'Flexible',
                },
                {
                  label: 'Available from',
                  value: pref.availableFrom ? formatDate(pref.availableFrom) : 'Now',
                },
                {
                  label: 'Shifts',
                  value: pref.shifts.map((s) => SHIFT_LABELS[s]).join(', ') || 'Any',
                },
                {
                  label: 'Job types',
                  value: pref.jobTypes.map((t) => JOB_TYPE_LABELS[t]).join(', ') || 'Any',
                },
              ]}
            />
          ) : (
            <p className="text-fg-muted text-sm">No preferences yet.</p>
          )}
        </Card>

        <Card title="Education">
          {applicant.education.length ? (
            <ul className="grid gap-3">
              {applicant.education.map((e, i) => (
                <li key={i} className="text-sm">
                  <p className="text-fg font-medium">{label('EDUCATION_LEVEL', e.levelCode)}</p>
                  <p className="text-fg-muted">
                    {[
                      e.fieldOfStudy,
                      e.institution,
                      e.isCurrent ? 'studying now' : e.completionYear,
                      e.grade,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-fg-muted text-sm">No education added.</p>
          )}
          {applicant.certifications.length > 0 && (
            <ul className="border-border grid gap-2 border-t pt-3 text-sm">
              {applicant.certifications.map((c, i) => (
                <li key={i}>
                  <span className="text-fg font-medium">{c.name}</span>
                  <span className="text-fg-muted">
                    {[c.issuer, monthLabel(c.issuedMonth)].filter(Boolean).map((v) => ` · ${v}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Work experience">
          {applicant.hasNoExperience ? (
            <p className="text-fg-muted text-sm">No work experience (fresher).</p>
          ) : applicant.experience.length ? (
            <ul className="grid gap-3">
              {applicant.experience.map((e, i) => (
                <li key={i} className="text-sm">
                  <p className="text-fg font-medium">
                    {e.jobTitle} — {e.employerName}
                  </p>
                  <p className="text-fg-muted">
                    {monthLabel(e.startMonth)} – {e.isCurrent ? 'now' : monthLabel(e.endMonth)}
                    {e.categoryCode ? ` · ${label('JOB_CATEGORY', e.categoryCode)}` : ''}
                  </p>
                  {e.description && <p className="text-fg-muted mt-1">{e.description}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-fg-muted text-sm">No experience added.</p>
          )}
        </Card>
      </div>

      {existingApplications && existingApplications.length > 0 && (
        <ApplicationsCard
          applicant={applicant}
          applications={existingApplications}
          canScheduleInterview={!!applicant.can.scheduleInterview}
          canReferToEmployer={!!applicant.can.referToEmployer}
          canRecordInterviewOutcome={!!applicant.can.recordInterviewOutcome}
          referPassedOnly={!!applicant.can.referPassedOnly}
        />
      )}

      {canReferMatchedJobs && (
        <MatchedJobsForReferralCard applicantId={applicant.id} jobs={matchedJobs ?? []} />
      )}

      {(applicant.can.manage || applicant.can.transfer) && (
        <Card title="Account">
          <p className="text-fg-muted text-sm">
            Registered {formatDate(applicant.createdAt)}
            {applicant.activatedAt ? ` · live since ${formatDate(applicant.activatedAt)}` : ''}.
          </p>
          {applicant.createdByStaff && (
            <p className="text-fg-muted mt-2 text-sm">
              Created by Saylani {applicant.createdByStaff.roleLabel ?? 'staff'}:{' '}
              {applicant.createdByStaff.name ?? 'staff account'}.
            </p>
          )}
          {applicant.registrationVerifiedSignedAt && (
            <p className="text-fg-muted mt-2 text-sm">
              Registration form verified &amp; signed{' '}
              {formatDate(applicant.registrationVerifiedSignedAt)}.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {applicant.can.manage && <EditDetailsDialog applicant={applicant} />}
            {applicant.can.manage && <ChangePhoneDialog applicant={applicant} />}
            {applicant.can.transfer && applicant.branch && (
              <TransferDialog applicant={applicant} branches={branches} listPath={listPath} />
            )}
            {canChangeStatus && (
              <ConfirmDialog
                title={
                  applicant.status === 'ACTIVE'
                    ? 'Deactivate this profile?'
                    : 'Reactivate this profile?'
                }
                description={
                  applicant.status === 'ACTIVE'
                    ? 'They will not be matched with new jobs until reactivated. The applicant can also reactivate it themselves.'
                    : 'They will be matched with jobs again.'
                }
                tone={applicant.status === 'ACTIVE' ? 'danger' : 'primary'}
                confirmLabel={applicant.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                requireReason={{
                  label: 'Reason',
                  minLength: 5,
                  placeholder: 'Recorded in the audit log',
                }}
                onConfirm={async (reason) => {
                  await apiFetch(`/api/v1/applicants/${applicant.id}/status`, {
                    method: 'PATCH',
                    body: { status: applicant.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', reason },
                  });
                  toast.success(
                    applicant.status === 'ACTIVE' ? 'Profile deactivated' : 'Profile reactivated',
                  );
                  router.refresh();
                }}
                trigger={
                  <Button
                    variant={applicant.status === 'ACTIVE' ? 'danger' : 'primary'}
                    leftIcon={applicant.status === 'ACTIVE' ? <UserX /> : <UserCheck />}
                  >
                    {applicant.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                  </Button>
                }
              />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
