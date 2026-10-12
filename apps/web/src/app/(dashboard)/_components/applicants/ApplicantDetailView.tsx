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
  Calendar,
  Pencil,
  Phone,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Badge, Button, Input, RadioGroup, Select, Textarea } from '@/components/atoms';
import type { SelectOption } from '@/components/atoms';
import {
  CNICInput,
  ConfirmDialog,
  FormField,
  KeyValue,
  Modal,
  PhoneInput,
  toast,
} from '@/components/molecules';
import { DocumentList, MapPinPicker, Timeline } from '@/components/organisms';
import type { ApplicantStaffView } from '@/domains/applicant';
import type { ApplicationView } from '@/domains/placement';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { formatCnic } from '@/lib/format/cnic';
import { formatDate } from '@/lib/format/date';
import { formatDistance } from '@/lib/format/distance';
import { formatPkMobileDisplay } from '@/lib/format/phone';
import { errorMessage, toFieldErrors, type FieldErrors } from './form';
import { DOCUMENT_STATUS_PILL, IDENTITY_PILL } from './labels';
import { openDocument } from './open-document';
import type { ProfileLabels } from './lists';

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
          <Input
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => set({ dateOfBirth: e.target.value })}
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
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/api/v1/applicants/${applicant.id}/phone`, {
        method: 'PUT',
        body: { phone, reason },
      });
      toast.success('Mobile number changed. The applicant must sign in again.');
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
      title="Change mobile number"
      description="For account recovery (lost SIM, or a CNIC registered from another number). Check the original CNIC in person first. The old number is signed out."
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="secondary" leftIcon={<Phone />}>
          Change mobile
        </Button>
      }
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <FormField label="New mobile number" required error={errors.phone}>
          <PhoneInput value={phone} onChange={(value) => setPhone(value.e164 ?? value.national)} />
        </FormField>
        <FormField label="Reason" required error={errors.reason} hint="Recorded in the audit log.">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Change number
          </Button>
        </div>
      </form>
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
        { method: 'POST', body: { branchId, reason } },
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
        <FormField label="Note" hint="Optional note for staff reference.">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
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

// ─── Schedule interview dialog ─────────────────────────────────────────

function ScheduleInterviewDialog({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [interviewAt, setInterviewAt] = useState('');
  const [location, setLocation] = useState('');
  const [interviewNote, setInterviewNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/api/v1/applications/${applicationId}/interview`, {
        method: 'POST',
        body: {
          interviewAt: new Date(interviewAt).toISOString(),
          interviewLocation: location || undefined,
          interviewNote: interviewNote || undefined,
        },
      });
      toast.success('Interview scheduled');
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
      title="Schedule interview"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="secondary" leftIcon={<Calendar />}>
          Schedule interview
        </Button>
      }
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <FormField label="Date & time" required error={errors.interviewAt}>
          <Input
            type="datetime-local"
            value={interviewAt}
            onChange={(e) => setInterviewAt(e.target.value)}
          />
        </FormField>
        <FormField label="Location" error={errors.interviewLocation}>
          <Input
            placeholder="Branch office, room number, etc."
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </FormField>
        <FormField label="Note for applicant" error={errors.interviewNote}>
          <Textarea
            rows={2}
            value={interviewNote}
            onChange={(e) => setInterviewNote(e.target.value)}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!interviewAt}>
            Confirm interview
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Applications list ─────────────────────────────────────────────────

const APPLICATION_STATUS_LABELS: Record<
  string,
  { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' }
> = {
  SHORTLISTED: { label: 'Shortlisted', tone: 'info' },
  INTERVIEW_SCHEDULED: { label: 'Interview scheduled', tone: 'warning' },
  FORWARDED: { label: 'Referred', tone: 'success' },
  HIRED: { label: 'Hired', tone: 'success' },
  REJECTED: { label: 'Not progressed', tone: 'neutral' },
};

function ApplicationsCard({
  applicant,
  applications,
  canScheduleInterview,
}: {
  applicant: ApplicantStaffView;
  applications: ApplicationView[];
  canScheduleInterview: boolean;
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
                  Interview:{' '}
                  {new Date(app.interviewAt).toLocaleString('en-PK', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {app.interviewLocation ? ` · ${app.interviewLocation}` : ''}
                </p>
              )}
              {app.note && <p className="text-fg-muted text-xs">Note: {app.note}</p>}
              {canScheduleInterview && app.status === 'SHORTLISTED' && (
                <div className="flex justify-end">
                  <ScheduleInterviewDialog applicationId={app.id} />
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
  listPath,
}: {
  applicant: ApplicantStaffView;
  labels: ProfileLabels;
  branches: SelectOption[];
  openJobs?: SelectOption[];
  existingApplications?: ApplicationView[];
  listPath: string;
}) {
  const router = useRouter();
  const p = applicant.personal;
  const label = (type: keyof ProfileLabels, code: string | null) =>
    code ? (labels[type][code] ?? code) : null;
  const pref = applicant.preferences;
  const canChangeStatus =
    applicant.can.manage && (applicant.status === 'ACTIVE' || applicant.status === 'INACTIVE');

  return (
    <div className="grid gap-6">
      {applicant.status === 'INACTIVE' && applicant.statusReason && (
        <p className="bg-surface-muted text-fg-muted rounded-lg px-4 py-3 text-sm">
          Deactivated by staff: {applicant.statusReason}
        </p>
      )}
      {applicant.status === 'DRAFT' && (
        <p className="bg-warning-soft text-warning-soft-fg rounded-lg px-4 py-3 text-sm">
          Profile not live yet. Still missing:{' '}
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
          <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
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
                {
                  label: 'Will travel',
                  value: pref?.willingRadiusM
                    ? `Up to ${formatDistance(pref.willingRadiusM)}`
                    : 'As far as allowed',
                },
              ]}
            />
            <MapPinPicker
              value={applicant.address.location}
              readOnly
              height="14rem"
              label="Applicant's home"
            />
          </div>
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
        />
      )}

      {(applicant.can.manage || applicant.can.transfer) && (
        <Card title="Account">
          <p className="text-fg-muted text-sm">
            Registered {formatDate(applicant.createdAt)}
            {applicant.activatedAt ? ` · live since ${formatDate(applicant.activatedAt)}` : ''}.
          </p>
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
