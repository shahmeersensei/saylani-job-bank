'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Textarea } from '@/components/atoms';
import { DateTimePicker, FormField, toast } from '@/components/molecules';
import { apiFetch, friendlyApiError } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format/date';
import type { ApplicationView } from '@/domains/placement';

const SCHEDULABLE: ApplicationView['status'][] = [
  'FORWARDED',
  'EMPLOYER_INTERVIEW_SCHEDULED',
  'EMPLOYER_INTERVIEW_POSTPONED',
  'EMPLOYER_INTERVIEW_CANCELLED',
  'ON_HOLD',
];

/** datetime-local value (local time, no timezone) for an ISO timestamp. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  applicationId: string;
  status: ApplicationView['status'];
  employerInterviewAt: string | null;
  employerInterviewLocation: string | null;
  employerInterviewNote: string | null;
}

/**
 * Employer interview scheduling (audit H-09): the second half of the
 * decided "staff first, then company" sequence. Staff interview the
 * candidate first; once forwarded, the employer schedules their own
 * interview here, and can reschedule, postpone or cancel it afterwards.
 * The applicant is notified of every change.
 */
export function EmployerInterviewScheduler({
  applicationId,
  status,
  employerInterviewAt,
  employerInterviewLocation,
  employerInterviewNote,
}: Props) {
  const router = useRouter();
  const [at, setAt] = useState(() => toLocalInput(employerInterviewAt));
  const [location, setLocation] = useState(employerInterviewLocation ?? '');
  const [note, setNote] = useState(employerInterviewNote ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!SCHEDULABLE.includes(status)) return null;

  const scheduled = employerInterviewAt != null;

  async function call(method: 'POST' | 'PATCH', body: Record<string, unknown>, success: string) {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/applications/${applicationId}/employer-interview`, {
        method,
        body,
      });
      toast.success(success);
      router.refresh();
    } catch (err) {
      const message = friendlyApiError(err);
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!at) {
      setError('Choose a date and time for the interview');
      return;
    }
    const interviewAt = new Date(at).toISOString();
    const body = {
      interviewAt,
      interviewLocation: location.trim() || undefined,
      interviewNote: note.trim() || undefined,
    };
    if (scheduled) {
      void call(
        'PATCH',
        { ...body, status: 'EMPLOYER_INTERVIEW_SCHEDULED' },
        'Interview rescheduled',
      );
    } else {
      void call('POST', body, 'Interview scheduled — the applicant has been notified');
    }
  };

  return (
    <div className="grid gap-4">
      {scheduled && (
        <div
          className="rounded-xl p-4 text-sm"
          style={{ background: 'var(--warning-soft)', color: 'var(--warning-soft-fg)' }}
        >
          <p className="font-semibold">Interview scheduled</p>
          <p className="mt-1">
            {formatDateTime(employerInterviewAt!)}
            {employerInterviewLocation ? ` · ${employerInterviewLocation}` : ''}
          </p>
          {employerInterviewNote && <p className="mt-1 opacity-80">{employerInterviewNote}</p>}
        </div>
      )}

      <form className="grid gap-3" onSubmit={submit} noValidate>
        <FormField label="Interview date & time" required error={error ?? undefined}>
          <DateTimePicker value={at} onChange={setAt} />
        </FormField>
        <FormField label="Location">
          <Input
            type="text"
            value={location}
            maxLength={300}
            placeholder="Office address or video call link"
            onChange={(e) => setLocation(e.target.value)}
          />
        </FormField>
        <FormField label="Note for the candidate">
          <Textarea
            value={note}
            maxLength={500}
            rows={2}
            placeholder="What to bring, who to ask for…"
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" loading={pending} disabled={!at}>
            {scheduled ? 'Reschedule interview' : 'Schedule interview'}
          </Button>
          {scheduled && status !== 'EMPLOYER_INTERVIEW_POSTPONED' && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                void call(
                  'PATCH',
                  { status: 'EMPLOYER_INTERVIEW_POSTPONED' },
                  'Interview postponed — the applicant has been notified',
                )
              }
            >
              Postpone
            </Button>
          )}
          {scheduled && status !== 'EMPLOYER_INTERVIEW_CANCELLED' && (
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                void call(
                  'PATCH',
                  { status: 'EMPLOYER_INTERVIEW_CANCELLED' },
                  'Interview cancelled — the applicant has been notified',
                )
              }
            >
              Cancel interview
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
