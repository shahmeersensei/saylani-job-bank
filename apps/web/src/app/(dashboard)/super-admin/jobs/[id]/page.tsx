import { requireRole } from '@/domains/auth';
import { getJobDetail } from '@/domains/job';
import {
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  SHIFT_TYPE_LABELS,
  GENDER_PREFERENCE_LABELS,
  type JobStatus,
  type JobType,
  type ShiftType,
  type GenderPreference,
} from '@jobbank/shared';
import { NotFoundError } from '@/domains/shared/errors';
import { Badge } from '@/components/atoms';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Job detail' };

const STATUS_BADGE: Record<
  JobStatus,
  { tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info' }
> = {
  DRAFT: { tone: 'neutral' },
  OPEN: { tone: 'success' },
  PAUSED: { tone: 'warning' },
  FILLED: { tone: 'success' },
  CLOSED: { tone: 'neutral' },
  EXPIRED: { tone: 'danger' },
};

function KV({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-fg-subtle text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="text-fg text-sm">{value ?? '—'}</dd>
    </div>
  );
}

export default async function SuperAdminJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { actor } = await requireRole('SUPER_ADMIN');
  const { id } = await params;

  try {
    const job = await getJobDetail(actor, id);
    const pill = STATUS_BADGE[job.status];

    return (
      <div className="grid w-full gap-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-fg text-2xl font-semibold">{job.title}</h1>
            <p className="text-fg-muted mt-1 text-sm">{job.categoryCode}</p>
          </div>
          <Badge tone={pill.tone}>{JOB_STATUS_LABELS[job.status]}</Badge>
        </header>

        <div className="border-border bg-surface grid gap-4 rounded-xl border p-5">
          <h2 className="text-fg font-medium">Job details</h2>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
            <KV label="Type" value={JOB_TYPE_LABELS[job.jobType as JobType]} />
            <KV label="Shift" value={SHIFT_TYPE_LABELS[job.shift as ShiftType]} />
            <KV
              label="Gender"
              value={GENDER_PREFERENCE_LABELS[job.genderPreference as GenderPreference]}
            />
            <KV label="Vacancies" value={`${job.vacanciesFilled} / ${job.vacancies} filled`} />
            {(job.salaryMin != null || job.salaryMax != null) && (
              <KV
                label="Salary (PKR/mo)"
                value={[job.salaryMin, job.salaryMax].filter((v) => v != null).join(' – ')}
              />
            )}
          </dl>
        </div>

        <div className="border-border bg-surface rounded-xl border p-5">
          <h2 className="text-fg mb-3 font-medium">Description</h2>
          <p className="text-fg-muted text-sm whitespace-pre-wrap">{job.description}</p>
        </div>
      </div>
    );
  } catch (e) {
    if (e instanceof NotFoundError) return notFound();
    throw e;
  }
}
