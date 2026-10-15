import { requireRole } from '@/domains/auth';
import { listMyApplications, listMessages } from '@/domains/placement';
import {
  CalendarCheck,
  CalendarX,
  CheckCircle2,
  Clock,
  Star,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ApplicationView } from '@/domains/placement';
import { RefuseOfferButton } from './_components/RefuseOfferButton';
import { ApplicantChatPanel } from './_components/ApplicantChatPanel';

export const metadata = { title: 'My Progress — Saylani Job Bank' };

type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

interface Stage {
  label: string;
  icon: LucideIcon;
  tone: Tone;
}

const STAGES: Record<string, Stage> = {
  SHORTLISTED: { label: 'Shortlisted', icon: TrendingUp, tone: 'info' },
  INTERVIEW_SCHEDULED: { label: 'Interview Scheduled', icon: CalendarCheck, tone: 'warning' },
  INTERVIEW_POSTPONED: { label: 'Interview Postponed', icon: Clock, tone: 'warning' },
  INTERVIEW_CANCELLED: { label: 'Interview Cancelled', icon: CalendarX, tone: 'neutral' },
  FORWARDED: { label: 'Referred to Employer', icon: TrendingUp, tone: 'info' },
  EMPLOYER_INTERVIEW_SCHEDULED: {
    label: 'Interview with Employer',
    icon: CalendarCheck,
    tone: 'warning',
  },
  EMPLOYER_INTERVIEW_POSTPONED: {
    label: 'Employer Interview Postponed',
    icon: Clock,
    tone: 'warning',
  },
  EMPLOYER_INTERVIEW_CANCELLED: {
    label: 'Employer Interview Cancelled',
    icon: CalendarX,
    tone: 'neutral',
  },
  ON_HOLD: { label: 'On Hold', icon: Clock, tone: 'warning' },
  OFFER_EXTENDED: { label: 'Job Offer Received', icon: Star, tone: 'success' },
  EMPLOYER_REJECTED: { label: 'Not Selected by Employer', icon: XCircle, tone: 'danger' },
  APPLICANT_REFUSED: { label: 'Offer Refused', icon: XCircle, tone: 'neutral' },
  HIRED: { label: 'Hired', icon: CheckCircle2, tone: 'success' },
  REJECTED: { label: 'Not Successful', icon: XCircle, tone: 'danger' },
};

const TONE_STYLE: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: 'var(--success-soft)', fg: 'var(--success-soft-fg)' },
  danger: { bg: 'var(--danger-soft, #fef2f2)', fg: 'var(--danger-soft-fg, #991b1b)' },
  warning: { bg: 'var(--warning-soft)', fg: 'var(--warning-soft-fg)' },
  neutral: { bg: 'var(--neutral-soft)', fg: 'var(--fg-muted)' },
  info: { bg: 'var(--primary-soft)', fg: 'var(--primary-soft-fg)' },
};

async function ApplicationCard({
  app,
  actor,
}: {
  app: ApplicationView;
  actor: { userId: string; applicantId: string | null };
}) {
  const stage = STAGES[app.status];
  const Icon = stage?.icon ?? TrendingUp;
  const tone = stage?.tone ?? 'neutral';
  const colors = TONE_STYLE[tone];

  const messages =
    app.status === 'APPLICANT_REFUSED'
      ? await listMessages(actor as Parameters<typeof listMessages>[0], app.id).catch(() => [])
      : [];

  return (
    <article
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <p className="text-fg font-semibold">{app.jobTitle}</p>
          <p className="text-fg-muted text-sm">{app.companyName}</p>
        </div>
        <span
          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: colors.bg, color: colors.fg }}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {stage?.label ?? app.status}
        </span>
      </div>

      {/* Interview details */}
      {app.interviewAt && (
        <div
          className="mt-4 rounded-xl p-3 text-sm"
          style={{ background: 'var(--warning-soft)', color: 'var(--warning-soft-fg)' }}
        >
          <p className="font-semibold">Job Bank Interview</p>
          <p>
            {new Date(app.interviewAt).toLocaleString('en-PK', {
              dateStyle: 'full',
              timeStyle: 'short',
            })}
            {app.interviewLocation ? ` · ${app.interviewLocation}` : ''}
          </p>
        </div>
      )}

      {app.employerInterviewAt && (
        <div
          className="mt-4 rounded-xl p-3 text-sm"
          style={{ background: 'var(--warning-soft)', color: 'var(--warning-soft-fg)' }}
        >
          <p className="font-semibold">Employer Interview</p>
          <p>
            {new Date(app.employerInterviewAt).toLocaleString('en-PK', {
              dateStyle: 'full',
              timeStyle: 'short',
            })}
            {app.employerInterviewLocation ? ` · ${app.employerInterviewLocation}` : ''}
          </p>
        </div>
      )}

      {/* Offer extended — show refuse button */}
      {app.status === 'OFFER_EXTENDED' && (
        <div className="mt-4 flex items-center gap-3">
          <p className="text-success-soft-fg text-sm font-semibold">
            You have received a job offer!
          </p>
          <RefuseOfferButton applicationId={app.id} />
        </div>
      )}

      {/* Applicant refused — show refusal reason + chat */}
      {app.status === 'APPLICANT_REFUSED' && (
        <div className="mt-4 grid gap-4">
          {app.applicantRefusalReason && (
            <div
              className="rounded-xl p-3 text-sm"
              style={{ background: 'var(--neutral-soft)', color: 'var(--fg-muted)' }}
            >
              <p className="font-semibold">Your refusal reason</p>
              <p className="mt-0.5">{app.applicantRefusalReason}</p>
            </div>
          )}
          <div>
            <p className="text-fg mb-2 text-sm font-semibold">Conversation with employer</p>
            <ApplicantChatPanel applicationId={app.id} messages={messages} />
          </div>
        </div>
      )}

      <p className="text-fg-muted mt-3 text-xs">
        Last updated {new Date(app.updatedAt).toLocaleDateString('en-PK')}
      </p>
    </article>
  );
}

export default async function ApplicantProgressPage() {
  const { actor } = await requireRole('APPLICANT');
  const applications = await listMyApplications(actor);

  return (
    <div className="grid w-full gap-6">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-bold">My Progress</h1>
        <p className="text-fg-muted text-sm">
          Track the status of your job applications through the Job Bank process.
        </p>
      </header>

      {applications.length === 0 ? (
        <div
          className="rounded-2xl border p-8 text-center"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <p className="text-fg-muted text-sm">
            No applications yet. Staff will shortlist you for jobs that match your profile.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {applications.map((app) => (
            <ApplicationCard key={app.id} app={app} actor={actor} />
          ))}
        </div>
      )}
    </div>
  );
}
