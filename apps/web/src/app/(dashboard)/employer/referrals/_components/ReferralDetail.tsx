import type { Actor } from '@/domains/shared/scope';
import { getApplicationForEmployer, listMessages } from '@/domains/placement';
import { Badge } from '@/components/atoms';
import { KeyValue } from '@/components/molecules';
import { MessageCircle } from 'lucide-react';
import { EmployerInterviewScheduler } from './EmployerInterviewScheduler';
import { ChatPanel } from './ChatPanel';
import { formatDate } from '@/lib/format/date';

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

/**
 * One referred candidate, with the full details the employer sees (2026-11-10 rule:
 * no hidden contact info — name, phone, email, address and the staff referral note
 * are all shown; only the CNIC is never selected). Used by the employer's own page
 * and by staff acting for the employer in the console.
 */
export async function ReferralDetail({ actor, id }: { actor: Actor; id: string }) {
  const [appData, messages] = await Promise.all([
    getApplicationForEmployer(actor, id),
    listMessages(actor, id).catch(() => []),
  ]);

  const { applicant, ...app } = appData;

  const applicantItems = [
    { label: 'Name', value: applicant.fullName },
    { label: "Father's name", value: applicant.fatherName },
    { label: 'Gender', value: applicant.gender },
    {
      label: 'Date of birth',
      value: formatDate(applicant.dateOfBirth),
    },
    { label: 'Email', value: applicant.email ?? '—' },
    { label: 'Phone', value: applicant.phone ?? '—' },
    { label: 'City', value: applicant.cityCode ?? '—' },
    {
      label: 'Address',
      value: [applicant.addressLine, applicant.areaCode].filter(Boolean).join(', ') || '—',
    },
    { label: 'Identity status', value: applicant.identityStatus },
  ];

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
                      {e.description && (
                        <p className="text-fg-muted mt-0.5 text-xs">{e.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {applicant.education.length > 0 && (
              <div className="mt-4">
                <p className="text-fg-muted mb-2 text-sm font-medium">Education</p>
                <div className="grid gap-2">
                  {applicant.education.map((e, i) => (
                    <div key={i} className="text-sm">
                      <span className="font-medium">{e.levelCode}</span>
                      {e.fieldOfStudy && <span> — {e.fieldOfStudy}</span>}
                      {e.institution && <span className="text-fg-muted"> · {e.institution}</span>}
                      <span className="text-fg-muted ml-2 text-xs">
                        {e.isCurrent ? 'In progress' : (e.completionYear ?? '')}
                        {e.grade ? ` · ${e.grade}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {applicant.languages.length > 0 && (
              <div className="mt-4">
                <p className="text-fg-muted mb-2 text-sm font-medium">Languages</p>
                <div className="flex flex-wrap gap-2">
                  {applicant.languages.map((l) => (
                    <Badge key={l.languageCode} tone="neutral">
                      {l.languageCode} · {l.proficiency}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {applicant.certifications.length > 0 && (
              <div className="mt-4">
                <p className="text-fg-muted mb-2 text-sm font-medium">Certifications</p>
                <div className="grid gap-2">
                  {applicant.certifications.map((c, i) => (
                    <div key={i} className="text-sm">
                      <span className="font-medium">{c.name}</span>
                      {c.issuer && <span className="text-fg-muted"> · {c.issuer}</span>}
                      {(c.issuedMonth || c.expiresMonth) && (
                        <span className="text-fg-muted ml-2 text-xs">
                          {c.issuedMonth ?? '?'} — {c.expiresMonth ?? 'no expiry'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {applicant.preferences && (
              <div className="mt-4">
                <p className="text-fg-muted mb-2 text-sm font-medium">Job Preferences</p>
                <KeyValue
                  columns={1}
                  items={[
                    {
                      label: 'Minimum salary',
                      value:
                        applicant.preferences.minSalaryPkr != null
                          ? `Rs ${applicant.preferences.minSalaryPkr.toLocaleString('en-PK')}`
                          : '—',
                    },
                    {
                      label: 'Preferred shifts',
                      value: applicant.preferences.shifts.join(', ') || '—',
                    },
                    {
                      label: 'Preferred job types',
                      value: applicant.preferences.jobTypes.join(', ') || '—',
                    },
                    {
                      label: 'Available from',
                      value: applicant.preferences.availableFrom
                        ? formatDate(applicant.preferences.availableFrom)
                        : '—',
                    },
                    {
                      label: 'Preferred categories',
                      value: applicant.preferences.categoryCodes.join(', ') || '—',
                    },
                  ]}
                />
              </div>
            )}
          </section>

          {/* Staff referral note */}
          {app.note && (
            <section
              className="rounded-xl border p-5"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <h2 className="text-fg mb-3 text-base font-semibold">Referral Note</h2>
              <p className="text-sm">{app.note}</p>
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

        {/* Right column */}
        <div className="grid content-start gap-6">
          {/* Employer interview (audit H-09): staff first, then company */}
          <section
            className="rounded-xl border p-5"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <h2 className="text-fg mb-4 text-base font-semibold">Your Interview</h2>
            <EmployerInterviewScheduler
              applicationId={app.id}
              status={app.status}
              employerInterviewAt={app.employerInterviewAt}
              employerInterviewLocation={app.employerInterviewLocation}
              employerInterviewNote={app.employerInterviewNote}
            />
          </section>

          {/* Referred by */}
          <section
            className="rounded-xl border p-5"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <h2 className="text-fg mb-4 text-base font-semibold">Referred By</h2>
            {applicant.referredBy ? (
              <KeyValue
                columns={1}
                items={[
                  { label: 'Name', value: applicant.referredBy.name },
                  {
                    label: 'Role',
                    value:
                      [applicant.referredBy.roleLabel, applicant.referredBy.title]
                        .filter(Boolean)
                        .join(' · ') || '—',
                  },
                  { label: 'Branch', value: applicant.referredBy.branchName ?? '—' },
                  {
                    label: 'Referred on',
                    value: formatDate(applicant.referredBy.referredAt),
                  },
                ]}
              />
            ) : (
              <p className="text-fg-muted text-sm">Not recorded</p>
            )}
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
              <p className="text-fg-muted text-xs">Referred on {formatDate(app.createdAt)}</p>
              <p className="text-fg-muted text-xs">Last updated {formatDate(app.updatedAt)}</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
