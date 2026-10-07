import { listQueue } from '@/domains/company';
import { requireRole } from '@/domains/auth';
import { Badge, Link } from '@/components/atoms';
import { EmptyState } from '@/components/molecules';
import { StatCard } from '@/components/molecules/StatCard';
import { AlertCircle, Building2, CheckCircle2, Clock, ShieldCheck, Zap } from 'lucide-react';

export const metadata = { title: 'Verification queue' };

export default async function VerifierQueuePage() {
  const { actor } = await requireRole('VERIFIER');
  const { items } = await listQueue(actor, {
    page: 1,
    pageSize: 50,
    limit: 50,
    offset: 0,
    sort: { field: 'slaDueOn', direction: 'asc' },
    q: undefined,
    filters: {},
  });

  const breached = items.filter((i) => i.sla === 'BREACHED').length;
  const dueToday = items.filter((i) => i.sla === 'DUE_TODAY').length;
  const available = items.filter((i) => !i.verifierId).length;
  const claimed = items.filter((i) => !!i.verifierId).length;

  return (
    <div className="grid w-full gap-8">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-bold">Verification Queue</h1>
        <p className="text-fg-muted text-sm">
          Companies submitted for verification — sorted by SLA due date.
        </p>
      </header>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="In Queue"
          value={items.length}
          icon={ShieldCheck}
          tone="blue"
          sub="Total awaiting review"
        />
        <StatCard label="Available" value={available} icon={Zap} tone="green" sub="Unclaimed" />
        <StatCard
          label="SLA Breached"
          value={breached}
          icon={AlertCircle}
          tone="red"
          sub="Overdue items"
        />
        <StatCard
          label="Claimed"
          value={claimed}
          icon={CheckCircle2}
          tone="amber"
          sub="Under review"
        />
      </div>

      {/* Queue list */}
      {items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Queue is empty"
          description="All companies have been reviewed or none are pending."
        />
      ) : (
        <div className="grid gap-3">
          {/* Breached first */}
          {breached > 0 && dueToday > 0 && (
            <p className="text-danger px-1 text-xs font-semibold tracking-wide uppercase">
              Overdue ({breached})
            </p>
          )}
          {items.map((item) => {
            const isBreached = item.sla === 'BREACHED';
            const isDueToday = item.sla === 'DUE_TODAY';

            return (
              <Link
                key={item.companyId}
                href={`/verifier/queue/${item.companyId}`}
                className="group flex items-center justify-between rounded-2xl border px-5 py-4 transition-all"
                style={{
                  background: isBreached ? 'var(--danger-soft)' : 'var(--surface)',
                  borderColor: isBreached
                    ? 'rgba(192,38,45,0.25)'
                    : isDueToday
                      ? 'rgba(180,83,9,0.25)'
                      : 'var(--border)',
                }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl"
                    style={{
                      background: isBreached ? 'rgba(192,38,45,0.12)' : 'var(--primary-soft)',
                    }}
                    aria-hidden="true"
                  >
                    <Building2
                      className="size-4"
                      style={{ color: isBreached ? 'var(--danger)' : 'var(--primary)' }}
                    />
                  </span>
                  <div className="grid gap-0.5">
                    <p className="text-fg font-semibold group-hover:underline group-hover:underline-offset-2">
                      {item.legalName}
                    </p>
                    <p className="text-fg-muted text-sm">
                      Round {item.round} · {item.branchName ?? 'No branch'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isBreached && <Badge tone="danger">Overdue</Badge>}
                  {isDueToday && !isBreached && <Badge tone="warning">Due today</Badge>}
                  <div
                    className="flex items-center gap-1 text-sm"
                    style={{ color: 'var(--fg-muted)' }}
                  >
                    <Clock className="size-3.5" aria-hidden="true" />
                    {new Date(item.slaDueOn).toLocaleDateString('en-PK', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </div>
                  {item.verifierId ? (
                    <Badge tone="info">{item.verifierName ?? 'Claimed'}</Badge>
                  ) : (
                    <Badge tone="neutral">Available</Badge>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
