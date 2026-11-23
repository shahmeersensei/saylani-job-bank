'use client';

import { ArrowRightLeft, Calendar } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Input, Select, Textarea } from '@/components/atoms';
import { FormField, DateTimePicker, Modal, toast } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { errorMessage, toFieldErrors, type FieldErrors } from './form';

/** Interview scheduling dialogs, shared by the applicant detail page and
    the Interviewer and Scheduler interviews list. Both call the same
    interview API (POST schedule / PATCH status), which enforces
    `interview:schedule_jobbank` server-side. The outcome dialog (0052)
    calls POST /interview/outcome, which enforces `interview:record_outcome`
    server-side. */

// ─── Schedule interview dialog ─────────────────────────────────────────

export function ScheduleInterviewDialog({ applicationId }: { applicationId: string }) {
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
          <DateTimePicker
            value={interviewAt}
            onChange={setInterviewAt}
            min={new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 16)}
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

// ─── Update interview status dialog ───────────────────────────────────────

export function UpdateInterviewDialog({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('INTERVIEW_POSTPONED');
  const [interviewAt, setInterviewAt] = useState('');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/api/v1/applications/${applicationId}/interview`, {
        method: 'PATCH',
        body: {
          status,
          ...(status === 'INTERVIEW_SCHEDULED' && interviewAt
            ? { interviewAt: new Date(interviewAt).toISOString() }
            : {}),
          ...(location ? { interviewLocation: location } : {}),
          ...(note ? { note } : {}),
        },
      });
      toast.success('Interview status updated');
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
      title="Update interview"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="secondary" leftIcon={<Calendar />}>
          Update interview
        </Button>
      }
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <FormField label="New status" required error={errors.status}>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: 'INTERVIEW_SCHEDULED', label: 'Reschedule (new time)' },
              { value: 'INTERVIEW_POSTPONED', label: 'Postpone' },
              { value: 'INTERVIEW_CANCELLED', label: 'Cancel interview' },
            ]}
          />
        </FormField>
        {status === 'INTERVIEW_SCHEDULED' && (
          <FormField label="New date & time" required error={errors.interviewAt}>
            <DateTimePicker
              value={interviewAt}
              onChange={setInterviewAt}
              min={new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 16)}
            />
          </FormField>
        )}
        <FormField label="Location" error={errors.interviewLocation}>
          <Input
            placeholder="Leave blank to keep existing location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </FormField>
        <FormField label="Note for applicant" error={errors.note}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={saving}
            disabled={status === 'INTERVIEW_SCHEDULED' && !interviewAt}
          >
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Record interview outcome dialog (0052) ─────────────────────────────

export function RecordOutcomeDialog({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [attendance, setAttendance] = useState<'ATTENDED' | 'NO_SHOW'>('ATTENDED');
  const [result, setResult] = useState<'PASSED' | 'FAILED'>('PASSED');
  const [feedback, setFeedback] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  // A no-show is always a fail — the server enforces this too.
  const effectiveResult = attendance === 'NO_SHOW' ? 'FAILED' : result;
  const feedbackRequired = effectiveResult === 'FAILED';
  const feedbackValid = !feedbackRequired || feedback.trim().length >= 5;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!feedbackValid) {
      setErrors({
        feedback: 'Feedback is required when the candidate fails (at least 5 characters)',
      });
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/v1/applications/${applicationId}/interview/outcome`, {
        method: 'POST',
        body: {
          attendance,
          result: effectiveResult,
          ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
        },
      });
      toast.success(
        effectiveResult === 'PASSED'
          ? 'Interview passed — candidate can now be referred to the employer'
          : 'Interview outcome recorded',
      );
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
      title="Record interview outcome"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="secondary" leftIcon={<Calendar />}>
          Record outcome
        </Button>
      }
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <FormField label="Attendance" required>
          <Select
            value={attendance}
            onChange={(e) => setAttendance(e.target.value as 'ATTENDED' | 'NO_SHOW')}
            options={[
              { value: 'ATTENDED', label: 'Attended' },
              { value: 'NO_SHOW', label: 'No-show — did not attend' },
            ]}
          />
        </FormField>
        <FormField
          label="Result"
          required
          error={attendance === 'NO_SHOW' ? 'A no-show is always recorded as failed' : undefined}
        >
          <Select
            value={effectiveResult}
            onChange={(e) => setResult(e.target.value as 'PASSED' | 'FAILED')}
            options={[
              { value: 'PASSED', label: 'Passed' },
              { value: 'FAILED', label: 'Failed' },
            ]}
            disabled={attendance === 'NO_SHOW'}
          />
        </FormField>
        <FormField
          label={feedbackRequired ? 'Feedback (required)' : 'Feedback (optional)'}
          error={errors.feedback}
        >
          <Textarea
            rows={3}
            placeholder={
              feedbackRequired
                ? 'Why did the candidate fail? At least 5 characters.'
                : 'Notes on the interview (optional)…'
            }
            value={feedback}
            maxLength={500}
            onChange={(e) => {
              setFeedback(e.target.value);
              setErrors({});
            }}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!feedbackValid}>
            Save outcome
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Refer to employer dialog ─────────────────────────────────────────────
// Moved here from ApplicantDetailView.tsx (0052) so the Interviews list can
// reuse the one and only refer flow — there is still a single implementation.
// The server enforces the pass-only rule for interviewer-only actors;
// Staff/BA keep their existing range (see referApplicantToEmployer).

export function ReferToEmployerDialog({
  applicationId,
  jobTitle,
  companyName,
}: {
  applicationId: string;
  jobTitle: string;
  companyName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | undefined>(undefined);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/api/v1/applications/${applicationId}/refer`, {
        method: 'POST',
        body: { ...(note ? { note } : {}) },
      });
      toast.success('Applicant referred to employer');
      setOpen(false);
      router.refresh();
    } catch (err) {
      // Audit 2026-11-11 (M-05): a too-long note failed with only a
      // generic alert; surface the field issue on the note itself.
      if (err instanceof ApiClientError && err.issueFor('note')) {
        setNoteError(err.issueFor('note'));
      } else {
        setError(errorMessage(err));
        toast.error(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Refer to employer"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="secondary" leftIcon={<ArrowRightLeft />}>
          Refer to employer
        </Button>
      }
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <div
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: 'var(--surface-muted)' }}
        >
          <p className="text-fg-muted">
            Referring this applicant to <strong className="text-fg">{companyName}</strong> for{' '}
            <strong className="text-fg">{jobTitle}</strong>. They will be notified immediately.
          </p>
        </div>
        <FormField label="Note (optional)" error={noteError}>
          <Textarea
            rows={2}
            placeholder="Any context for the employer or internal record…"
            value={note}
            maxLength={500}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteError(undefined);
              setError(null);
            }}
          />
        </FormField>
        {error && (
          <p className="text-danger text-sm" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Confirm referral
          </Button>
        </div>
      </form>
    </Modal>
  );
}
