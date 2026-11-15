import { requireRole } from '@/domains/auth';
import { listReferrals } from '@/domains/placement';
import { ValidationError } from '@/domains/shared/errors';
import { parseListQuery } from '@/domains/shared/pagination';
import { Badge, Button } from '@/components/atoms';
import { EmptyState } from '@/components/molecules';
import { Users } from 'lucide-react';
import NextLink from 'next/link';
import { formatDate } from '@/lib/format/date';

export const metadata = { title: 'Referrals — Saylani Job Bank' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// M32: referrals are paginated (20/page, newest first); the domain layer
// already returns one page plus metadata, this wires the URL params
// through to it.
const listOptions = {
  sortable: ['createdAt'] as const,
  defaultSort: { field: 'createdAt' as const, direction: 'desc' as const },
};

const STATUS_BADGE: Record<
  string,
  { tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info' }
> = {
  FORWARDED: { tone: 'info' },
  EMPLOYER_INTERVIEW_SCHEDULED: { tone: 'warning' },
  EMPLOYER_INTERVIEW_POSTPONED: { tone: 'warning' },
  EMPLOYER_INTERVIEW_CANCELLED: { tone: 'neutral' },
  ON_HOLD: { tone: 'warning' },
  OFFER_EXTENDED: { tone: 'success' },
  EMPLOYER_REJECTED: { tone: 'danger' },
  APPLICANT_REFUSED: { tone: 'neutral' },
  HIRED: { tone: 'success' },
  REJECTED: { tone: 'danger' },
};

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

export default async function EmployerReferralsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { actor } = await requireRole('EMPLOYER');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string' && value) params.set(key, value);
  }
  let query;
  try {
    query = parseListQuery(params, listOptions);
  } catch (error) {
    // A hand-edited URL with bad params falls back to the default view.
    if (!(error instanceof ValidationError)) throw error;
    query = parseListQuery(new URLSearchParams(), listOptions);
  }
  const { items: referrals, pagination } = await listReferrals(actor, query);

  // Group by job
  const byJob = new Map<string, typeof referrals>();
  for (const r of referrals) {
    const key = r.jobId;
    const list = byJob.get(key) ?? [];
    list.push(r);
    byJob.set(key, list);
  }

  return (
    <div className="grid w-full gap-6">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-bold">Referrals</h1>
        <p className="text-fg-muted text-sm">
          Candidates referred by Saylani Job Bank for your open positions.
        </p>
      </header>

      {referrals.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No referrals yet"
          description="Saylani Job Bank will refer candidates to you when suitable applicants are found for your jobs."
        />
      ) : (
        <div className="grid gap-8">
          {[...byJob.entries()].map(([jobId, apps]) => {
            const jobTitle = apps[0]!.jobTitle;
            return (
              <section key={jobId} className="grid gap-3">
                <h2 className="text-fg text-base font-semibold">{jobTitle}</h2>
                <div
                  className="overflow-hidden rounded-xl border"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr
                        className="border-b text-left"
                        style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}
                      >
                        <th className="px-4 py-3 font-semibold">Applicant ID</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Last Updated</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {apps.map((app) => (
                        <tr
                          key={app.id}
                          className="border-b last:border-0"
                          style={{ borderColor: 'var(--border)' }}
                        >
                          <td className="px-4 py-3 font-mono text-xs opacity-70">
                            {app.id.slice(0, 8)}…
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={STATUS_BADGE[app.status]?.tone ?? 'neutral'}>
                              {STATUS_LABELS[app.status] ?? app.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-xs opacity-70">
                            {formatDate(app.updatedAt)}
                          </td>
                          <td className="px-4 py-3">
                            <NextLink
                              href={`/employer/referrals/${app.id}`}
                              className="text-xs font-medium underline underline-offset-4"
                              style={{ color: 'var(--primary)' }}
                            >
                              View
                            </NextLink>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
      {pagination.pageCount > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-sm">
          <p className="text-fg-muted numeric">
            Showing {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
            {pagination.total.toLocaleString('en-PK')}
          </p>
          <div className="flex gap-2">
            {pagination.page > 1 ? (
              <Button asChild variant="secondary" size="sm">
                <NextLink href={`/employer/referrals?page=${pagination.page - 1}`}>
                  Previous
                </NextLink>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled>
                Previous
              </Button>
            )}
            {pagination.page < pagination.pageCount ? (
              <Button asChild variant="secondary" size="sm">
                <NextLink href={`/employer/referrals?page=${pagination.page + 1}`}>Next</NextLink>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled>
                Next
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
