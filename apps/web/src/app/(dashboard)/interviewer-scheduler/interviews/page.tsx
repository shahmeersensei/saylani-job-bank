import Link from 'next/link';
import { Badge } from '@/components/atoms';
import { requireRole } from '@/domains/auth';
import { listInterviews, type InterviewListItem } from '@/domains/placement';
import {
  ScheduleInterviewDialog,
  UpdateInterviewDialog,
} from '../../_components/applicants/InterviewDialogs';
import { formatDateTime } from '@/lib/format/date';

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
};

const INTERVIEW_STATUSES = new Set([
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_POSTPONED',
  'INTERVIEW_CANCELLED',
]);

function formatInterviewAt(iso: string | null): string {
  if (!iso) return '—';
  return formatDateTime(iso);
}

function InterviewRow({ item }: { item: InterviewListItem }) {
  const pill = STATUS_LABELS[item.status] ?? {
    label: item.status,
    tone: 'neutral' as const,
  };
  return (
    <li className="border-border grid gap-2 rounded-lg border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-fg font-medium">
            <Link
              href={`/interviewer-scheduler/applicants/${item.applicantId}`}
              className="underline-offset-2 hover:underline"
            >
              {item.applicantName}
            </Link>
          </p>
          <p className="text-fg-muted text-xs">
            {item.jobTitle} · {item.companyName}
          </p>
        </div>
        <Badge tone={pill.tone}>{pill.label}</Badge>
      </div>
      {item.interviewAt && (
        <p className="text-fg-muted text-xs">
          Interview: {formatInterviewAt(item.interviewAt)}
          {item.interviewLocation ? ` · ${item.interviewLocation}` : ''}
        </p>
      )}
      {item.interviewNote && <p className="text-fg-muted text-xs">{item.interviewNote}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {item.status === 'SHORTLISTED' && (
          <ScheduleInterviewDialog applicationId={item.applicationId} />
        )}
        {INTERVIEW_STATUSES.has(item.status) && (
          <UpdateInterviewDialog applicationId={item.applicationId} />
        )}
      </div>
    </li>
  );
}

function InterviewSection({
  title,
  items,
  empty,
}: {
  title: string;
  items: InterviewListItem[];
  empty: string;
}) {
  return (
    <section className="grid gap-3">
      <h2 className="text-fg text-base font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-fg-muted text-sm">{empty}</p>
      ) : (
        <ul className="grid gap-3">
          {items.map((item) => (
            <InterviewRow key={item.applicationId} item={item} />
          ))}
        </ul>
      )}
    </section>
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
  const past = items.filter((item) => !toSchedule.includes(item) && !upcoming.includes(item));
  return (
    <div className="grid w-full gap-6">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Interviews</h1>
        <p className="text-fg-muted text-sm">
          Candidates awaiting an interview and scheduled interviews in your branch.
        </p>
      </header>
      <InterviewSection
        title="To schedule"
        items={toSchedule}
        empty="No candidates awaiting an interview."
      />
      <InterviewSection title="Upcoming" items={upcoming} empty="No interviews scheduled." />
      <InterviewSection title="Past" items={past} empty="No past interviews." />
    </div>
  );
}
