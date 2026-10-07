import { requireRole } from '@/domains/auth';
import { getMyCompany } from '@/domains/company';
import { listMyJobs } from '@/domains/job';
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS, type JobType } from '@jobbank/shared';
import { Badge, Button, Link } from '@/components/atoms';
import { EmptyState } from '@/components/molecules';
import { Briefcase, Building2, PlusCircle } from 'lucide-react';
import NextLink from 'next/link';

export const metadata = { title: 'My jobs' };

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

export default async function EmployerJobsPage() {
  const { actor } = await requireRole('EMPLOYER');
  const company = await getMyCompany(actor);

  if (!company) {
    return (
      <div className="grid w-full gap-6">
        <header>
          <h1 className="text-fg text-2xl font-semibold">My jobs</h1>
        </header>
        <div
          className="grid gap-4 rounded-2xl border p-8 text-center"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div
            className="mx-auto grid size-14 place-items-center rounded-2xl"
            style={{ background: 'var(--primary-soft)' }}
          >
            <Building2 className="size-7" style={{ color: 'var(--primary)' }} />
          </div>
          <div className="grid gap-1">
            <h2 className="text-fg text-lg font-semibold">Register your company first</h2>
            <p className="text-fg-muted text-sm">
              You need a verified company profile before you can post jobs.
            </p>
          </div>
          <div>
            <Button asChild>
              <NextLink href="/employer/company">Register company</NextLink>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (company.status !== 'VERIFIED') {
    return (
      <div className="grid w-full gap-6">
        <header>
          <h1 className="text-fg text-2xl font-semibold">My jobs</h1>
        </header>
        <div
          className="grid gap-4 rounded-2xl border p-8 text-center"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div
            className="mx-auto grid size-14 place-items-center rounded-2xl"
            style={{ background: 'var(--warning-soft)' }}
          >
            <Building2 className="size-7" style={{ color: 'var(--warning)' }} />
          </div>
          <div className="grid gap-1">
            <h2 className="text-fg text-lg font-semibold">Company under review</h2>
            <p className="text-fg-muted text-sm">
              You can post jobs once your company is verified by a Job Bank staff member.
            </p>
          </div>
          <div>
            <Button asChild variant="secondary">
              <NextLink href="/employer/company">View company status</NextLink>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const jobs = await listMyJobs(actor);

  return (
    <div className="grid w-full gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-fg text-2xl font-semibold">My jobs</h1>
          <p className="text-fg-muted mt-1 text-sm">
            {jobs.length} posting{jobs.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link href="/employer/jobs/new">
          <Button size="sm">
            <PlusCircle className="mr-1.5 size-4" />
            Post a job
          </Button>
        </Link>
      </header>

      {jobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No jobs yet"
          description="Post your first job to start receiving applicants."
        />
      ) : (
        <div className="grid gap-3">
          {jobs.map((job) => {
            const pill = STATUS_BADGE[job.status] ?? { tone: 'neutral' as const };
            return (
              <Link
                key={job.id}
                href={`/employer/jobs/${job.id}`}
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
