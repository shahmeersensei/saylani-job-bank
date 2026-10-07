'use client';

import { COMPANY_SIZE_LABELS, LEGAL_STRUCTURE_LABELS, type CompanyStatus } from '@jobbank/shared';
import { ArrowLeft, Building2, ExternalLink, Pause, Play } from 'lucide-react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, StatusPill, Textarea } from '@/components/atoms';
import { FormField, KeyValue } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';
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

export function StaffCompanyPanel({
  company,
  canSuspend,
  canManage,
}: {
  company: CompanyView;
  canSuspend: boolean;
  canManage: boolean;
}) {
  const pathname = usePathname();
  const backHref = pathname.includes('super-admin')
    ? '/super-admin/companies'
    : '/branch-admin/companies';
  const [company_, setCompany_] = useState(company);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suspendNote, setSuspendNote] = useState('');
  const [showSuspendForm, setShowSuspendForm] = useState(false);

  const pill = STATUS_PILL[company_.status];

  async function changeStatus(status: 'SUSPENDED' | 'VERIFIED', note?: string) {
    setPending(status);
    setError(null);
    try {
      const { data: saved } = await apiFetch<CompanyView>(
        `/api/v1/companies/${company_.id}/status`,
        {
          method: 'PATCH',
          body: { status, note: note ?? null },
        },
      );
      setCompany_(saved);
      setShowSuspendForm(false);
      setSuspendNote('');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setPending(null);
    }
  }

  async function getDocUrl(docId: string) {
    try {
      const { data } = await apiFetch<{ url: string; expiresIn: number }>(
        `/api/v1/companies/${company_.id}/documents/${docId}/url`,
      );
      window.open(data.url, '_blank');
    } catch {
      setError('Could not get document link.');
    }
  }

  return (
    <div className="grid w-full gap-6">
      <div>
        <NextLink
          href={backHref}
          className="text-fg-muted mb-3 flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft className="size-4" />
          Back to companies
        </NextLink>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h1 className="text-fg text-2xl font-semibold">{company_.details.legalName}</h1>
            {company_.details.tradeName && (
              <p className="text-fg-muted text-sm">Trading as {company_.details.tradeName}</p>
            )}
            <div className="mt-1">
              <StatusPill label={pill.label} tone={pill.variant} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canSuspend && company_.status === 'VERIFIED' && !showSuspendForm && (
              <Button
                variant="danger"
                leftIcon={<Pause />}
                onClick={() => setShowSuspendForm(true)}
              >
                Suspend
              </Button>
            )}
            {canSuspend && company_.status === 'SUSPENDED' && (
              <Button
                variant="primary"
                leftIcon={<Play />}
                loading={pending === 'VERIFIED'}
                onClick={() => void changeStatus('VERIFIED')}
              >
                Reinstate
              </Button>
            )}
          </div>
        </header>
      </div>

      {error && (
        <div className="bg-danger-soft text-danger-soft-fg rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {showSuspendForm && (
        <div className="border-border bg-surface grid gap-3 rounded-xl border p-5">
          <h2 className="text-fg font-semibold">Suspend company</h2>
          <FormField label="Reason for suspension (optional — shown to the employer)">
            <Textarea
              rows={2}
              value={suspendNote}
              onChange={(e) => setSuspendNote(e.target.value)}
            />
          </FormField>
          <div className="flex gap-2">
            <Button
              variant="danger"
              loading={pending === 'SUSPENDED'}
              leftIcon={<Pause />}
              onClick={() => void changeStatus('SUSPENDED', suspendNote || undefined)}
            >
              Confirm suspension
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setShowSuspendForm(false);
                setSuspendNote('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <section className="border-border bg-surface grid gap-4 rounded-xl border p-5">
        <h2 className="text-fg font-semibold">Company details</h2>
        <KeyValue
          columns={2}
          items={[
            { label: 'NTN', value: company_.details.ntn },
            { label: 'Reg. no.', value: company_.details.registrationNo ?? '—' },
            { label: 'Structure', value: LEGAL_STRUCTURE_LABELS[company_.details.legalStructure] },
            { label: 'Size', value: COMPANY_SIZE_LABELS[company_.details.sizeBand] },
            { label: 'Branch', value: company_.branch?.name ?? '—' },
          ]}
        />
        {company_.details.website && (
          <a
            href={company_.details.website}
            target="_blank"
            rel="noreferrer"
            className="text-accent flex w-fit items-center gap-1 text-sm hover:underline"
          >
            <ExternalLink className="size-3.5" />
            {company_.details.website}
          </a>
        )}
        {company_.details.description && (
          <p className="text-fg-muted text-sm">{company_.details.description}</p>
        )}
      </section>

      <section className="border-border bg-surface grid gap-4 rounded-xl border p-5">
        <h2 className="text-fg font-semibold">Primary contact</h2>
        {company_.contacts.length === 0 ? (
          <p className="text-fg-muted text-sm">No contacts on file.</p>
        ) : (
          <div className="grid gap-2">
            {company_.contacts.map((c, i) => (
              <div key={i} className="flex items-start justify-between text-sm">
                <div>
                  <p className="text-fg font-medium">{c.name}</p>
                  {c.designation && <p className="text-fg-muted">{c.designation}</p>}
                  <p className="text-fg-muted">{c.phone}</p>
                  {c.email && <p className="text-fg-muted">{c.email}</p>}
                </div>
                {c.isPrimary && <Badge tone="info">Main</Badge>}
              </div>
            ))}
          </div>
        )}
      </section>

      {company_.documents.length > 0 && (
        <section className="border-border bg-surface grid gap-4 rounded-xl border p-5">
          <h2 className="text-fg font-semibold">Documents</h2>
          <div className="grid gap-3">
            {company_.documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between gap-3">
                <div className="grid gap-0.5">
                  <p className="text-fg text-sm font-medium">{doc.typeCode.replace(/_/g, ' ')}</p>
                  <p className="text-fg-muted text-xs">{doc.fileName}</p>
                </div>
                <div className="flex items-center gap-2">
                  {doc.reviewStatus === 'ACCEPTED' && <Badge tone="success">Accepted</Badge>}
                  {doc.reviewStatus === 'REJECTED' && <Badge tone="danger">Rejected</Badge>}
                  {doc.reviewStatus === 'PENDING' && <Badge tone="neutral">Pending</Badge>}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void getDocUrl(doc.id)}
                    rightIcon={<ExternalLink className="size-3.5" />}
                  >
                    View
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
