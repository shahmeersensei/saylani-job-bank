import { requireRole } from '@/domains/auth';
import { getApplicationForEmployer, listMessages } from '@/domains/placement';
import { Badge } from '@/components/atoms';
import { KeyValue } from '@/components/molecules';
import { MessageCircle } from 'lucide-react';
import { EmployerReferralActions } from '../_components/EmployerReferralActions';
import { ChatPanel } from '../_components/ChatPanel';

export const metadata = { title: 'Referred Candidate — Saylani Job Bank' };

const STATUS_LABELS: Record<string, string> = {
  FORWARDED: 'Referred',
  EMPLOYER_INTERVIEW_SCHEDULED: 'Interview Scheduled',
  EMPLOYER_INTERVIEW_POSTPONED: 'Interview Postponed',
  EMPLOYER_INTERVIEW_CANCELLED: 'Interview Cancelled',
  ON_HOLD: 'On Hold',
  OFFER_EXTENDED: 'Offer Extended',
  EMPLOYER_REJECTED: 'Not Selected',
  APPLICANT_REFUSED: 'Offer Refused',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
};

const STATUS_TONES: Record<string, 'success' | 'danger' | 'warning' | 'neutral' | 'info'> = {
  FORWARDED: 'info',
  EMPLOYER_INTERVIEW_SCHEDULED: 'warning',
  EMPLOYER_INTERVIEW_POSTPONED: 'warning',
  EMPLOYER_INTERVIEW_CANCELLED: 'neutral',
  ON_HOLD: 'warning',
  OFFER_EXTENDED: 'success',
  EMPLOYER_REJECTED: 'danger',
  APPLICANT_REFUSED: 'neutral',
  HIRED: 'success',
  REJECTED: 'danger',
};

export default async function EmployerReferralDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { actor } = await requireRole('EMPLOYER');
  const [appData, messages] = await Promise.all([
    getApplicationForEmployer(actor, id),
    listMessages(actor, id).catch(() => []),
  ]);

  const { applicant, ...app } = appData;

  const applicantItems = [
    { label: 'Name', value: applicant.fullName },
    { label: 'City', value: applicant.cityCode ?? '—' },
    { label: 'Phone', value: applicant.phone ?? '—' },
  ];

  const interviewItems = app.employerInterviewAt
    ? [
        {
          label: 'Date & Time',
          value: new Date(app.employerInterviewAt).toLocaleString('en-PK', {
            dateStyle: 'full',
            timeStyle: 'short',
          }),
        },
        { label: 'Location', value: app.employerInterviewLocation ?? '—' },
        ...(app.employerInterviewNote ? [{ label: 'Note', value: app.employerInterviewNote }] : []),
      ]
    : [];

  return (
    <div className="grid w-full gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-3 py-1 text-xs font-bold"
              style={{ background: 'var(--success-soft)', color: 'var(--success-soft-fg)' }}
            >
              REFERRED CANDIDATE
            </span>
          </div>
          <h1 className="text-fg text-2xl font-bold">{applicant.fullName}</h1>
          <p className="text-fg-muted text-sm">
            Applied for: <span className="font-medium">{app.jobTitle}</span> at{' '}
            <span className="font-medium">{app.companyName}</span>
          </p>
        </div>
        <Badge tone={STATUS_TONES[app.status] ?? 'neutral'}>
          {STATUS_LABELS[app.status] ?? app.status}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Left column */}
        <div className="grid gap-6">
          {/* Applicant details */}
          <section
            className="rounded-xl border p-5"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <h2 className="text-fg mb-4 text-base font-semibold">Applicant Information</h2>
            <KeyValue items={applicantItems} columns={1} />

            {applicant.skills.length > 0 && (
              <div className="mt-4">
                <p className="text-fg-muted mb-2 text-sm font-medium">Skills</p>
                <div className="flex flex-wrap gap-2">
                  {applicant.skills.map((s) => (
                    <Badge key={s.skillCode} tone="neutral">
                      {s.skillCode} · {s.level} · {s.years}y
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {applicant.experience.length > 0 && (
              <div className="mt-4">
                <p className="text-fg-muted mb-2 text-sm font-medium">Experience</p>
                <div className="grid gap-2">
                  {applicant.experience.map((e, i) => (
                    <div key={i} className="text-sm">
                      <span className="font-medium">{e.jobTitle}</span>
                      {' at '}
                      <span>{e.employerName}</span>
                      <span className="text-fg-muted ml-2 text-xs">
                        {e.startMonth} — {e.isCurrent ? 'Present' : (e.endMonth ?? '?')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Interview details */}
          {interviewItems.length > 0 && (
            <section
              className="rounded-xl border p-5"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <h2 className="text-fg mb-4 text-base font-semibold">Scheduled Interview</h2>
              <KeyValue items={interviewItems} columns={1} />
            </section>
          )}

          {/* Offer extended status */}
          {app.status === 'OFFER_EXTENDED' && (
            <div
              className="rounded-xl border p-5 text-sm"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--success-soft)',
                color: 'var(--success-soft-fg)',
              }}
            >
              <p className="font-semibold">Awaiting candidate response</p>
              <p className="mt-1 opacity-80">
                The job offer has been sent. The applicant will respond via their dashboard.
              </p>
            </div>
          )}

          {/* Applicant refusal + chat */}
          {app.status === 'APPLICANT_REFUSED' && (
            <section
              className="rounded-xl border p-5"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <h2 className="text-fg mb-3 flex items-center gap-2 text-base font-semibold">
                <MessageCircle className="size-4" />
                Refusal &amp; Chat
              </h2>
              {app.applicantRefusalReason && (
                <div
                  className="mb-4 rounded-xl p-4 text-sm"
                  style={{
                    background: 'var(--warning-soft)',
                    color: 'var(--warning-soft-fg)',
                  }}
                >
                  <p className="font-semibold">Refusal reason</p>
                  <p className="mt-1">{app.applicantRefusalReason}</p>
                </div>
              )}
              <ChatPanel applicationId={app.id} messages={messages} currentUserRole="EMPLOYER" />
            </section>
          )}
        </div>

        {/* Right column — actions */}
        <div className="grid content-start gap-6">
          <section
            className="rounded-xl border p-5"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <h2 className="text-fg mb-4 text-base font-semibold">Actions</h2>
            <EmployerReferralActions
              applicationId={app.id}
              status={app.status}
              employerInterviewAt={app.employerInterviewAt}
              employerInterviewLocation={app.employerInterviewLocation}
              companyName={app.companyName}
              jobTitle={app.jobTitle}
            />
          </section>

          {/* Application timeline */}
          <section
            className="rounded-xl border p-5"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <h2 className="text-fg mb-4 text-base font-semibold">Status Timeline</h2>
            <div className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: 'var(--primary)' }} />
                <span className="font-medium">
                  Current: {STATUS_LABELS[app.status] ?? app.status}
                </span>
              </div>
              <p className="text-fg-muted text-xs">
                Referred on {new Date(app.createdAt).toLocaleDateString('en-PK')}
              </p>
              <p className="text-fg-muted text-xs">
                Last updated {new Date(app.updatedAt).toLocaleDateString('en-PK')}
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
