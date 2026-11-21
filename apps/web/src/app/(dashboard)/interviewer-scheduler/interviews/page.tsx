import Link from 'next/link';
import { Badge } from '@/components/atoms';
import { requireRole } from '@/domains/auth';
import { listInterviews, type InterviewListItem } from '@/domains/placement';
import { DashboardAutoRefresh } from '../../_components/DashboardAutoRefresh';
import {
  RecordOutcomeDialog,
  ReferToEmployerDialog,
  ScheduleInterviewDialog,
  UpdateInterviewDialog,
} from '../../_components/applicants/InterviewDialogs';
import { formatDateTime } from '@/lib/format/date';
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  History,
  MapPin,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

export const metadata = { title: 'Interviews — Saylani Job Bank' };

/** Live data on every load — dashboards are never statically cached. */
export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<
  string,
  { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' }
> = {
  SHORTLISTED: { label: 'To schedule', tone: 'info' },
  INTERVIEW_SCHEDULED: { label: 'Interview scheduled', tone: 'warning' },
  INTERVIEW_POSTPONED: { label: 'Postponed', tone: 'warning' },
  INTERVIEW_CANCELLED: { label: 'Interview cancelled', tone: 'neutral' },
  INTERVIEW_PASSED: { label: 'Interview passed', tone: 'success' },
  INTERVIEW_FAILED: { label: 'Interview failed', tone: 'danger' },
};

const INTERVIEW_STATUSES = new Set([
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_POSTPONED',
  'INTERVIEW_CANCELLED',
]);

/** Outcomes can be recorded only from a scheduled (or postponed) interview. */
const OUTCOME_STATUSES = new Set(['INTERVIEW_SCHEDULED', 'INTERVIEW_POSTPONED']);

/**
 * Soft icon tints, same palette as the dashboard's STATUS_PILL — one
 * tint per interview state, so a row's state reads from its icon before
 * its label does.
 */
const DEFAULT_ROW_ICON = { icon: CalendarClock, bg: '#eff6ff', color: '#1d4ed8' };
const ROW_ICON: Record<string, { icon: LucideIcon; bg: string; color: string }> = {
  SHORTLISTED: DEFAULT_ROW_ICON,
  INTERVIEW_SCHEDULED: { icon: Calendar, bg: '#f0fdf4', color: '#15803d' },
  INTERVIEW_POSTPONED: { icon: Clock, bg: '#fffbeb', color: '#b45309' },
  INTERVIEW_CANCELLED: { icon: XCircle, bg: '#f8faf9', color: '#6b7d74' },
  INTERVIEW_PASSED: { icon: CheckCircle2, bg: '#f0fdf4', color: '#15803d' },
  INTERVIEW_FAILED: { icon: XCircle, bg: '#fff1f2', color: '#be123c' },
};

function formatInterviewAt(iso: string | null): string {
  if (!iso) return '—';
  return formatDateTime(iso);
}

function InterviewRow({ item }: { item: InterviewListItem }) {
  const pill = STATUS_LABELS[item.status] ?? {
    label: item.status,
    tone: 'neutral' as const,
  };
  const rowIcon = ROW_ICON[item.status] ?? DEFAULT_ROW_ICON;
  const RIcon = rowIcon.icon;
  return (
    <li className="grid gap-4 px-6 py-4 transition-colors hover:bg-[#f8faf9] sm:grid-cols-[1fr_auto]">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl"
          style={{ background: rowIcon.bg }}
          aria-hidden="true"
        >
          <RIcon className="size-5" style={{ color: rowIcon.color }} />
        </span>
        <div className="min-w-0">
          <p className="text-fg truncate text-sm font-semibold">
            <Link
              href={`/interviewer-scheduler/applicants/${item.applicantId}`}
              className="underline-offset-2 hover:underline"
            >
              {item.applicantName}
            </Link>
          </p>
          <p className="text-fg-muted truncate text-xs">
            {item.jobTitle} · {item.companyName}
          </p>
          {item.interviewAt && (
            <p className="text-fg-muted mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3.5" aria-hidden="true" />
                {formatInterviewAt(item.interviewAt)}
              </span>
              {item.interviewLocation && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden="true" />
                  {item.interviewLocation}
                </span>
              )}
            </p>
          )}
          {item.interviewNote && <p className="text-fg-muted mt-1 text-xs">{item.interviewNote}</p>}
          {item.interviewResult && (
            <p className="text-fg-muted mt-1 text-xs">
              Outcome: <span className="font-medium">{item.interviewResult}</span>
              {item.interviewAttendance
                ? ` · ${item.interviewAttendance === 'NO_SHOW' ? 'No-show' : 'Attended'}`
                : ''}
              {item.interviewFeedback ? ` — ${item.interviewFeedback}` : ''}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-start justify-between gap-3 sm:flex-col sm:items-end">
        <Badge tone={pill.tone}>{pill.label}</Badge>
        <div className="flex flex-wrap justify-end gap-2">
          {item.status === 'SHORTLISTED' && (
            <ScheduleInterviewDialog applicationId={item.applicationId} />
          )}
          {INTERVIEW_STATUSES.has(item.status) && (
            <UpdateInterviewDialog applicationId={item.applicationId} />
          )}
          {OUTCOME_STATUSES.has(item.status) && (
            <RecordOutcomeDialog applicationId={item.applicationId} />
          )}
          {item.status === 'INTERVIEW_PASSED' && (
            <ReferToEmployerDialog
              applicationId={item.applicationId}
              jobTitle={item.jobTitle}
              companyName={item.companyName}
            />
          )}
        </div>
      </div>
    </li>
  );
}

function InterviewSection({
  id,
  title,
  icon: SectionIcon,
  tint,
  items,
  empty,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  tint: { bg: string; color: string };
  items: InterviewListItem[];
  empty: string;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-6 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg"
            style={{ background: tint.bg }}
            aria-hidden="true"
          >
            <SectionIcon className="size-4" style={{ color: tint.color }} />
          </span>
          <h2 className="text-fg truncate text-base font-semibold">{title}</h2>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
          style={{ background: 'var(--surface-muted)', color: 'var(--fg-muted)' }}
        >
          {items.length}
        </span>
      </header>
      {items.length === 0 ? (
        <div className="grid place-items-center gap-2 px-6 py-10 text-center">
          <span
            className="grid size-10 place-items-center rounded-xl"
            style={{ background: tint.bg }}
            aria-hidden="true"
          >
            <SectionIcon className="size-5" style={{ color: tint.color }} />
          </span>
          <p className="text-fg-muted text-sm">{empty}</p>
        </div>
      ) : (
        <ul className="grid divide-y divide-[var(--border)]">
          {items.map((item) => (
            <InterviewRow key={item.applicationId} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SummaryStat({
  href,
  label,
  sub,
  value,
  icon: StatIcon,
  tint,
}: {
  href: string;
  label: string;
  sub: string;
  value: number;
  icon: LucideIcon;
  tint: { bg: string; color: string };
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:bg-[#f8faf9]"
    >
      <span
        className="grid size-10 shrink-0 place-items-center rounded-xl"
        style={{ background: tint.bg }}
        aria-hidden="true"
      >
        <StatIcon className="size-5" style={{ color: tint.color }} />
      </span>
      <span className="min-w-0">
        <span className="text-fg block text-2xl leading-7 font-extrabold tabular-nums">
          {value}
        </span>
        <span className="text-fg-muted block truncate text-xs font-medium">{label}</span>
        <span className="text-fg-muted block truncate text-xs">{sub}</span>
      </span>
    </a>
  );
}

export default async function InterviewsPage() {
  const { actor } = await requireRole('INTERVIEWER_SCHEDULER');
  const items = await listInterviews(actor);
  const now = new Date();
  const toSchedule = items.filter((item) => item.status === 'SHORTLISTED');
  const upcoming = items.filter(
    (item) =>
      (item.status === 'INTERVIEW_SCHEDULED' || item.status === 'INTERVIEW_POSTPONED') &&
      item.interviewAt &&
      new Date(item.interviewAt) > now,
  );
  // 0052 — passed candidates wait here until the interviewer refers them
  // to the employer; failed/cancelled and already-past interviews are Past.
  const passed = items.filter((item) => item.status === 'INTERVIEW_PASSED');
  const past = items.filter(
    (item) => !toSchedule.includes(item) && !upcoming.includes(item) && !passed.includes(item),
  );
  return (
    <div className="grid w-full gap-6">
      <DashboardAutoRefresh />
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Interviews</h1>
        <p className="text-fg-muted text-sm">
          Candidates awaiting an interview and scheduled interviews in your branch.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat
          href="#to-schedule"
          label="To schedule"
          sub="Awaiting a date"
          value={toSchedule.length}
          icon={CalendarClock}
          tint={{ bg: '#eff6ff', color: '#1d4ed8' }}
        />
        <SummaryStat
          href="#upcoming"
          label="Upcoming"
          sub="In the diary"
          value={upcoming.length}
          icon={Calendar}
          tint={{ bg: '#f0fdf4', color: '#15803d' }}
        />
        <SummaryStat
          href="#passed"
          label="Passed — awaiting referral"
          sub="Needs your referral"
          value={passed.length}
          icon={CheckCircle2}
          tint={{ bg: '#fffbeb', color: '#b45309' }}
        />
        <SummaryStat
          href="#past"
          label="Past"
          sub="Decided or cancelled"
          value={past.length}
          icon={History}
          tint={{ bg: '#f8faf9', color: '#6b7d74' }}
        />
      </div>
      <InterviewSection
        id="to-schedule"
        title="To schedule"
        icon={CalendarClock}
        tint={{ bg: '#eff6ff', color: '#1d4ed8' }}
        items={toSchedule}
        empty="No candidates awaiting an interview."
      />
      <InterviewSection
        id="upcoming"
        title="Upcoming"
        icon={Calendar}
        tint={{ bg: '#f0fdf4', color: '#15803d' }}
        items={upcoming}
        empty="No interviews scheduled."
      />
      <InterviewSection
        id="passed"
        title="Passed — awaiting referral"
        icon={CheckCircle2}
        tint={{ bg: '#fffbeb', color: '#b45309' }}
        items={passed}
        empty="No passed candidates awaiting referral."
      />
      <InterviewSection
        id="past"
        title="Past"
        icon={History}
        tint={{ bg: '#f8faf9', color: '#6b7d74' }}
        items={past}
        empty="No past interviews."
      />
    </div>
  );
}
