'use client';

import { Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Select, Textarea, type SelectOption } from '@/components/atoms';
import { FormField, toast } from '@/components/molecules';
import { apiFetch, friendlyApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import type { JobApplicantReferralView } from '@/domains/job';

interface Props {
  jobId: string;
  /** Applicants in this staff member's city scope (verified + unverified, for now). */
  targets: SelectOption[];
  initialReferrals: JobApplicantReferralView[];
}

/**
 * Staff refers this job to an applicant (verified or, for now, unverified).
 * The applicant sees the job
 * on their Jobs page from the moment the referral is made — and only then.
 */
export function ReferJobToApplicantPanel({ jobId, targets, initialReferrals }: Props) {
  const [applicantId, setApplicantId] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<JobApplicantReferralView[]>(initialReferrals);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!applicantId) {
      setAlert('Choose an applicant to refer this job to.');
      return;
    }
    setAlert(null);
    setLoading(true);
    try {
      const { data } = await apiFetch<JobApplicantReferralView>(
        `/api/v1/jobs/${jobId}/applicant-referrals`,
        {
          method: 'POST',
          body: { applicantId, note: note.trim() ? note.trim() : undefined },
        },
      );
      setReferrals((prev) =>
        prev.some((r) => r.applicantId === data.applicantId) ? prev : [data, ...prev],
      );
      setApplicantId('');
      setNote('');
      toast.success(`Job referred to ${data.applicantName ?? 'applicant'}.`);
    } catch (error) {
      setAlert(friendlyApiError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <h2 className="text-fg mb-1 flex items-center gap-2 font-semibold">
        <Send className="size-4" style={{ color: 'var(--primary)' }} />
        Refer to applicant
      </h2>
      <p className="text-fg-muted mb-4 text-sm">
        Share this job with a specific applicant. They will see it on their Jobs page and get a
        notification; applicants without a referral cannot see it.
      </p>

      {targets.length === 0 ? (
        <p className="text-fg-muted text-sm">No applicants in your scope yet.</p>
      ) : (
        <form className="grid gap-4" onSubmit={submit} noValidate>
          {alert && (
            <p
              role="alert"
              className="bg-danger-soft text-danger-soft-fg rounded-lg px-4 py-3 text-sm"
            >
              {alert}
            </p>
          )}
          <FormField
            label="Applicant"
            required
            hint="Verified and unverified applicants are listed for now"
          >
            <Select
              value={applicantId}
              onChange={(event) => setApplicantId(event.target.value)}
              placeholder="Choose an applicant"
              options={targets.filter((t) => !referrals.some((r) => r.applicantId === t.value))}
            />
          </FormField>
          <FormField label="Note for the applicant" hint="Optional — shown to the applicant">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. This matches your driving experience — apply before Friday."
              rows={2}
              maxLength={500}
            />
          </FormField>
          <div>
            <Button type="submit" loading={loading} disabled={!applicantId}>
              <Send className="mr-1.5 size-4" />
              Refer job
            </Button>
          </div>
        </form>
      )}

      {referrals.length > 0 && (
        <div className="mt-5 grid gap-2 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <p
            className="text-xs font-medium tracking-wide uppercase"
            style={{ color: 'var(--fg-subtle)' }}
          >
            Referred to ({referrals.length})
          </p>
          {referrals.map((r) => (
            <div key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-fg font-medium">{r.applicantName ?? 'Applicant'}</span>
              <span className="text-fg-muted text-xs">
                {formatDate(r.referredAt)}
                {r.referredByName ? ` · by ${r.referredByName}` : ''}
              </span>
              {r.note && <p className="text-fg-muted w-full text-xs">“{r.note}”</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
