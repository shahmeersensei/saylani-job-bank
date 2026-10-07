'use client';

import {
  COMPANY_STATUS_LABELS,
  LEGAL_STRUCTURE_LABELS,
  COMPANY_SIZE_LABELS,
  VERIFICATION_EVENT_LABELS,
  type CompanyStatus,
} from '@jobbank/shared';
import { Building2, CheckCircle2, XCircle, AlertCircle, Clock } from 'lucide-react';
import NextLink from 'next/link';
import { Button, StatusPill } from '@/components/atoms';
import { KeyValue } from '@/components/molecules';
import type { CompanyView } from '@/domains/company/repository';

const STATUS_PILL: Record<
  CompanyStatus,
  { label: string; variant: 'success' | 'danger' | 'warning' | 'neutral' | 'info' }
> = {
  DRAFT: { label: 'Draft', variant: 'neutral' },
  SUBMITTED: { label: 'Submitted', variant: 'info' },
  UNDER_VERIFICATION: { label: 'Under review', variant: 'info' },
  INFO_REQUESTED: { label: 'Info needed', variant: 'warning' },
  RESUBMITTED: { label: 'Resubmitted', variant: 'info' },
  VERIFIED: { label: 'Verified', variant: 'success' },
  REJECTED: { label: 'Not approved', variant: 'danger' },
  SUSPENDED: { label: 'Suspended', variant: 'danger' },
};

export function CompanyStatusPanel({ company }: { company: CompanyView }) {
  const pill = STATUS_PILL[company.status];
  const v = company.verification;

  return (
    <div className="grid w-full gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-fg text-2xl font-semibold">{company.details.legalName}</h1>
          {company.details.tradeName && (
            <p className="text-fg-muted text-sm">Trading as {company.details.tradeName}</p>
          )}
          <StatusPill label={pill.label} tone={pill.variant} />
        </div>
        {company.status === 'VERIFIED' && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="text-success size-5" />
            <span className="text-fg-muted">
              Verified{' '}
              {company.verifiedAt ? new Date(company.verifiedAt).toLocaleDateString('en-PK') : ''}
            </span>
          </div>
        )}
      </header>

      {company.status === 'SUSPENDED' && (
        <div className="bg-danger-soft text-danger-soft-fg grid gap-1 rounded-xl px-5 py-4 text-sm">
          <p className="font-semibold">Your company has been suspended.</p>
          <p>Contact your Job Bank branch to understand the reason and how to proceed.</p>
        </div>
      )}

      <section className="border-border bg-surface grid gap-4 rounded-xl border p-5">
        <h2 className="text-fg font-semibold">Company details</h2>
        <KeyValue
          columns={2}
          items={[
            { label: 'NTN', value: company.details.ntn },
            {
              label: 'Legal structure',
              value: LEGAL_STRUCTURE_LABELS[company.details.legalStructure],
            },
            { label: 'Size', value: COMPANY_SIZE_LABELS[company.details.sizeBand] },
            { label: 'Branch', value: company.branch?.name ?? '—' },
          ]}
        />
      </section>

      {v && (
        <section className="border-border bg-surface grid gap-4 rounded-xl border p-5">
          <h2 className="text-fg font-semibold">Verification history</h2>
          <ol className="grid gap-2 text-sm">
            {[v].map((ver) => (
              <li key={ver.id} className="flex items-start gap-3">
                {ver.state === 'VERIFIED' ? (
                  <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" />
                ) : ver.state === 'REJECTED' ? (
                  <XCircle className="text-danger mt-0.5 size-4 shrink-0" />
                ) : ver.state === 'INFO_REQUESTED' ? (
                  <AlertCircle className="text-warning mt-0.5 size-4 shrink-0" />
                ) : (
                  <Clock className="text-fg-muted mt-0.5 size-4 shrink-0" />
                )}
                <div className="grid gap-0.5">
                  <span className="text-fg">{COMPANY_STATUS_LABELS[company.status]}</span>
                  {ver.infoRequest && <p className="text-fg-muted">{ver.infoRequest}</p>}
                  {ver.decisionNote && <p className="text-fg-muted">{ver.decisionNote}</p>}
                  <span className="text-fg-subtle text-xs">
                    Due {new Date(ver.slaDueOn).toLocaleDateString('en-PK')}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="flex gap-3">
        <Button asChild variant="secondary" leftIcon={<Building2 />}>
          <NextLink href="/employer/company?step=details">Edit details</NextLink>
        </Button>
      </div>
    </div>
  );
}
