'use client';

import { Calendar } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Input, Select, Textarea } from '@/components/atoms';
import { FormField, DateTimePicker, Modal, toast } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { errorMessage, toFieldErrors, type FieldErrors } from './form';

/** Interview scheduling dialogs, shared by the applicant detail page and
    the Interviewer and Scheduler interviews list. Both call the same
    interview API (POST schedule / PATCH status), which enforces
    `interview:schedule_jobbank` server-side. */

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
