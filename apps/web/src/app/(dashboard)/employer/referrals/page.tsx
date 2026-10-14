import { requireRole } from '@/domains/auth';
import { listReferrals } from '@/domains/placement';
import { Badge } from '@/components/atoms';
import { EmptyState } from '@/components/molecules';
import { Calendar, Users } from 'lucide-react';
import NextLink from 'next/link';

export const metadata = { title: 'Referrals — Saylani Job Bank' };

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

export default async function EmployerReferralsPage() {
  const { actor } = await requireRole('EMPLOYER');
  const referrals = await listReferrals(actor);

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
                        <th className="px-4 py-3 font-semibold">Interview</th>
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
                          <td className="px-4 py-3">
                            {app.employerInterviewAt ? (
                              <span className="flex items-center gap-1 text-xs">
                                <Calendar className="size-3.5" />
                                {new Date(app.employerInterviewAt).toLocaleDateString('en-PK', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </span>
                            ) : (
                              <span className="text-fg-muted text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs opacity-70">
                            {new Date(app.updatedAt).toLocaleDateString('en-PK', {
                              day: 'numeric',
                              month: 'short',
                            })}
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
    </div>
  );
}
