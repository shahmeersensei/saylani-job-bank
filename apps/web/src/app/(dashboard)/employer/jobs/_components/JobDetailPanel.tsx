'use client';

import { useState, useTransition } from 'react';
import {
  BONUS_TIER_LABELS,
  GENDER_PREFERENCE_LABELS,
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  MEDICAL_COVERAGE_LABELS,
  SHIFT_TYPE_LABELS,
} from '@jobbank/shared';
import type { JobView } from '@/domains/job/repository';
import { apiFetch } from '@/lib/api/client';
import { Badge, Button, Link } from '@/components/atoms';
import { allowedTransitions } from '@/domains/job/rules';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';

interface Props {
  job: JobView;
}

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

const TRANSITION_LABELS: Record<string, string> = {
  publish: 'Publish',
  pause: 'Pause',
  resume: 'Resume',
  close: 'Close',
  reopen: 'Reopen',
};

const TRANSITION_STATUS: Record<string, string> = {
  publish: 'OPEN',
  pause: 'PAUSED',
  resume: 'OPEN',
  close: 'CLOSED',
  reopen: 'OPEN',
};

function KV({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-fg-subtle text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="text-fg text-sm">{value ?? '—'}</dd>
    </div>
  );
}

export function JobDetailPanel({ job }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const transitions = allowedTransitions(job.status);
  const pill = STATUS_BADGE[job.status] ?? { tone: 'neutral' as const };

  function handleTransition(transition: string) {
    startTransition(async () => {
      setError(null);
      try {
        await apiFetch<JobView>(`/api/v1/jobs/me/${job.id}/status`, {
          method: 'PATCH',
          body: { status: TRANSITION_STATUS[transition] },
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      setError(null);
      try {
        await apiFetch<{ deleted: boolean }>(`/api/v1/jobs/me/${job.id}`, { method: 'DELETE' });
        router.push('/employer/jobs');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div className="grid w-full gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-fg text-2xl font-semibold">{job.title}</h1>
          <p className="text-fg-muted mt-1 text-sm">{job.categoryCode}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={pill.tone}>{JOB_STATUS_LABELS[job.status]}</Badge>
          {(job.status === 'DRAFT' || job.status === 'OPEN' || job.status === 'PAUSED') && (
            <Link href={`/employer/jobs/${job.id}/edit`}>
              <Button size="sm" variant="secondary">
                <Pencil className="mr-1.5 size-4" />
                Edit
              </Button>
            </Link>
          )}
          {job.status === 'DRAFT' && (
            <Button size="sm" variant="secondary" onClick={handleDelete} disabled={pending}>
              <Trash2 className="text-danger mr-1.5 size-4" />
              Delete
            </Button>
          )}
        </div>
      </header>

      <div className="border-border bg-surface grid gap-4 rounded-xl border p-5">
        <h2 className="text-fg font-medium">Job details</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
          <KV label="Type" value={JOB_TYPE_LABELS[job.jobType]} />
          <KV label="Shift" value={SHIFT_TYPE_LABELS[job.shift]} />
          <KV label="Gender" value={GENDER_PREFERENCE_LABELS[job.genderPreference]} />
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

      <div className="border-border bg-surface grid gap-4 rounded-xl border p-5">
        <h2 className="text-fg font-medium">Benefits &amp; Perks</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
          <KV label="Medical coverage" value={MEDICAL_COVERAGE_LABELS[job.medicalCoverage]} />
          <KV label="Bonus" value={BONUS_TIER_LABELS[job.bonusTier]} />
          {job.annualLeaveDays != null && (
            <KV label="Annual leave" value={`${job.annualLeaveDays} days / year`} />
          )}
        </dl>
        {(() => {
          const active = [
            job.fuelAllowance && 'Fuel allowance',
            job.flexibleHours && 'Flexible hours',
            job.workFromHome && 'Work from home',
            job.providentFund && 'Provident fund',
            job.transportAllowance && 'Transport allowance',
            job.eobi && 'EOBI',
            job.lifeInsurance && 'Life insurance',
          ].filter(Boolean) as string[];
          return active.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {active.map((perk) => (
                <span
                  key={perk}
                  className="bg-surface-muted border-border text-fg-subtle rounded-full border px-3 py-1 text-xs"
                >
                  {perk}
                </span>
              ))}
            </div>
          ) : null;
        })()}
      </div>

      {transitions.length > 0 && (
        <div className="border-border bg-surface rounded-xl border p-5">
          <h2 className="text-fg mb-3 font-medium">Actions</h2>
          <div className="flex flex-wrap gap-3">
            {transitions.map((t) => (
              <Button key={t} size="sm" onClick={() => handleTransition(t)} disabled={pending}>
                {TRANSITION_LABELS[t]}
              </Button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-danger text-sm">{error}</p>}
    </div>
  );
}
