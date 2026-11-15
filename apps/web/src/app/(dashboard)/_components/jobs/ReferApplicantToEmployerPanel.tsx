'use client';

import { ArrowRightLeft } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Select, Textarea, type SelectOption } from '@/components/atoms';
import { FormField, toast } from '@/components/molecules';
import { apiFetch, friendlyApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import type { ApplicationView, JobCandidateReferralView } from '@/domains/placement';

interface Props {
  jobId: string;
  jobTitle: string;
  /** Applicants in this staff member's city scope (verified + unverified, for now). */
  targets: SelectOption[];
  initialReferrals: JobCandidateReferralView[];
}

const STATUS_LABELS: Record<string, string> = {
  FORWARDED: 'Referred',
  EMPLOYER_INTERVIEW_SCHEDULED: 'Employer interview',
  EMPLOYER_INTERVIEW_POSTPONED: 'Employer interview postponed',
  EMPLOYER_INTERVIEW_CANCELLED: 'Employer interview cancelled',
  ON_HOLD: 'On hold',
  OFFER_EXTENDED: 'Offer extended',
  EMPLOYER_REJECTED: 'Not selected',
  APPLICANT_REFUSED: 'Offer refused',
  HIRED: 'Hired',
};

/**
 * Staff refers an applicant to the employer for this job, straight from
 * the job detail page — no detour through the applicant detail page, no
 * separate shortlist step first. The employer sees the candidate on their
 * Referrals page from the moment the referral is made.
 */
export function ReferApplicantToEmployerPanel({
  jobId,
  jobTitle,
  targets,
  initialReferrals,
}: Props) {
  const [applicantId, setApplicantId] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<JobCandidateReferralView[]>(initialReferrals);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!applicantId) {
      setAlert('Choose an applicant to refer to the employer.');
      return;
    }
    setAlert(null);
    setLoading(true);
    try {
      // The API returns the application view (no applicant name), so the
      // name comes from the picker option chosen above.
      const selected = targets.find((t) => t.value === applicantId);
      const { data } = await apiFetch<ApplicationView>(
        `/api/v1/jobs/${jobId}/candidate-referrals`,
        {
          method: 'POST',
          body: { applicantId, note: note.trim() ? note.trim() : undefined },
        },
      );
      const entry: JobCandidateReferralView = {
        applicationId: data.id,
        applicantId: data.applicantId,
        applicantName: selected?.label ?? 'Applicant',
        status: data.status,
        referredAt: data.updatedAt,
      };
      setReferrals((prev) =>
        prev.some((r) => r.applicantId === entry.applicantId) ? prev : [entry, ...prev],
      );
      setApplicantId('');
      setNote('');
      toast.success(`${entry.applicantName} referred to the employer.`);
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
        <ArrowRightLeft className="size-4" style={{ color: 'var(--primary)' }} />
        Refer to employer
      </h2>
      <p className="text-fg-muted mb-4 text-sm">
        Send a candidate to the employer for {jobTitle}. They will see the candidate on their
        Referrals page and get a notification; the applicant is notified too.
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
          <FormField label="Note for the employer" hint="Optional — shown to the employer">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Strong match — 3 years of delivery experience, available immediately."
              rows={2}
              maxLength={500}
            />
          </FormField>
          <div>
            <Button type="submit" loading={loading} disabled={!applicantId}>
              <ArrowRightLeft className="mr-1.5 size-4" />
              Refer to employer
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
            Referred to employer ({referrals.length})
          </p>
          {referrals.map((r) => (
            <div
              key={r.applicationId}
              className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
            >
              <span className="text-fg font-medium">{r.applicantName}</span>
              <span className="text-fg-muted text-xs">
                {STATUS_LABELS[r.status] ?? r.status} · {formatDate(r.referredAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
