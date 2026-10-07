import { requireRole } from '@/domains/auth';
import { listJobs } from '@/domains/job';
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS, type JobType } from '@jobbank/shared';
import { Badge, Link } from '@/components/atoms';
import { EmptyState } from '@/components/molecules';
import { Briefcase } from 'lucide-react';

export const metadata = { title: 'Jobs' };

const STATUS_BADGE: Record<
  string,
  { tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info' }
> = {
  DRAFT: { tone: 'neutral' },
  OPEN: { tone: 'success' },
  PAUSED: { tone: 'warning' },
  FILLED: { tone: 'success' },
  CLOSED: { tone: 'neutral' },
  EXPIRED: { tone: 'danger' },
};

export default async function SuperAdminJobsPage() {
  const { actor } = await requireRole('SUPER_ADMIN');
  const { items, pagination } = await listJobs(actor, {
    page: 1,
    pageSize: 100,
    limit: 100,
    offset: 0,
    sort: { field: 'createdAt', direction: 'desc' },
    q: undefined,
    filters: {},
  });

  return (
    <div className="grid w-full gap-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold">Jobs</h1>
        <p className="text-fg-muted mt-1 text-sm">{pagination.total} total</p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No jobs yet"
          description="Jobs posted by employers will appear here."
        />
      ) : (
        <div className="grid gap-3">
          {items.map((job) => {
            const pill = STATUS_BADGE[job.status] ?? { tone: 'neutral' as const };
            return (
              <Link
                key={job.id}
                href={`/super-admin/jobs/${job.id}`}
                className="border-border bg-surface hover:bg-surface-muted flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <Briefcase className="text-fg-muted mt-0.5 size-5 shrink-0" />
                  <div>
                    <p className="text-fg font-medium">{job.title}</p>
                    <p className="text-fg-muted text-sm">
                      {JOB_TYPE_LABELS[job.jobType as JobType]} · {job.vacancies} vacancies
                    </p>
                  </div>
                </div>
                <Badge tone={pill.tone}>{JOB_STATUS_LABELS[job.status]}</Badge>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
