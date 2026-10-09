'use client';

import { COMPANY_SIZE_LABELS, LEGAL_STRUCTURE_LABELS, type CompanyStatus } from '@jobbank/shared';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Lock,
  Unlock,
  XCircle,
} from 'lucide-react';
import NextLink from 'next/link';
import { useRef, useState } from 'react';
import { Badge, Button, Select, StatusPill, Textarea } from '@/components/atoms';
import { FormField, KeyValue } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import type { CompanyView } from '@/domains/company';

const STATUS_PILL: Record<
  CompanyStatus,
  { label: string; variant: 'success' | 'danger' | 'warning' | 'neutral' | 'info' }
> = {
  DRAFT: { label: 'Draft', variant: 'neutral' },
  SUBMITTED: { label: 'Submitted', variant: 'info' },
  UNDER_VERIFICATION: { label: 'Under review', variant: 'info' },
  INFO_REQUESTED: { label: 'More info needed', variant: 'warning' },
  RESUBMITTED: { label: 'Resubmitted', variant: 'info' },
  VERIFIED: { label: 'Verified', variant: 'success' },
  REJECTED: { label: 'Not approved', variant: 'danger' },
  SUSPENDED: { label: 'Suspended', variant: 'danger' },
};

const REJECTION_REASONS = [
  { value: 'INVALID_DOCUMENTS', label: 'Invalid or forged documents' },
  { value: 'NTN_MISMATCH', label: 'NTN does not match records' },
  { value: 'DUPLICATE_REGISTRATION', label: 'Duplicate company' },
  { value: 'INCOMPLETE_INFO', label: 'Incomplete information' },
  { value: 'OTHER', label: 'Other' },
];

export function VerifierReviewPanel({
  company,
  actorId: _actorId,
}: {
  company: CompanyView;
  actorId: string;
}) {
  const idempotencyKeys = useRef(new Map<string, string>());
  const [company_, setCompany_] = useState(company);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInfoForm, setShowInfoForm] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [infoText, setInfoText] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  const ver = company_.verification;
  const pill = STATUS_PILL[company_.status];
  const isClaimed = !!ver?.state && ver.state === 'UNDER_VERIFICATION';

  function idempotencyKey(action: string) {
    const key = idempotencyKeys.current.get(action);
    if (key) return key;
    const generated = crypto.randomUUID();
    idempotencyKeys.current.set(action, generated);
    return generated;
  }

  async function callAction(
    action: string,
    body?: Record<string, unknown>,
    key = idempotencyKey(action),
  ) {
    setPending(action);
    setError(null);
    try {
      const { data: saved } = await apiFetch<CompanyView>(
        `/api/v1/companies/${company_.id}/${action}`,
        {
          method: 'POST',
          body,
          idempotencyKey: key,
        },
      );
      setCompany_(saved);
      if (action === 'claim') {
        // refresh to show changes
      }
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

  async function reviewDoc(docId: string, status: 'ACCEPTED' | 'REJECTED', note?: string) {
    setPending(`doc-${docId}`);
    setError(null);
    const action = `review-${docId}-${status}`;
    try {
      const { data: saved } = await apiFetch<CompanyView>(
        `/api/v1/companies/${company_.id}/documents/${docId}/review`,
        {
          method: 'PATCH',
          body: { decision: status, note: note ?? null },
          idempotencyKey: idempotencyKey(action),
        },
      );
      setCompany_(saved);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setPending(null);
    }
  }

  async function requestInfo() {
    await callAction('request-info', { note: infoText });
    setShowInfoForm(false);
    setInfoText('');
  }

  async function verify() {
    await callAction('verify', {}, idempotencyKey('verify'));
  }

  async function reject() {
    await callAction(
      'reject',
      { reasonCode: rejectReason, note: rejectNote || null },
      idempotencyKey('reject'),
    );
    setShowRejectForm(false);
  }

  return (
    <div className="grid w-full gap-6">
      <div>
        <NextLink
          href="/verifier/queue"
          className="text-fg-muted mb-3 flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft className="size-4" />
          Back to queue
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
            {!isClaimed && (
              <Button
                variant="primary"
                loading={pending === 'claim'}
                onClick={() => void callAction('claim')}
                leftIcon={<Lock />}
              >
                Claim
              </Button>
            )}
            {isClaimed && (
              <Button
                variant="secondary"
                loading={pending === 'release'}
                onClick={() => void callAction('release', { note: null })}
                leftIcon={<Unlock />}
              >
                Release
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
            { label: 'Contacts', value: company_.contacts.length.toString() },
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
      </section>

      <section className="border-border bg-surface grid gap-4 rounded-xl border p-5">
        <h2 className="text-fg font-semibold">Documents</h2>
        {company_.documents.length === 0 ? (
          <p className="text-fg-muted text-sm">No documents uploaded.</p>
        ) : (
          <div className="grid gap-3">
            {company_.documents.map((doc) => (
              <div key={doc.id} className="flex flex-wrap items-center justify-between gap-3">
                <div className="grid gap-0.5">
                  <p className="text-fg text-sm font-medium">{doc.typeCode.replace(/_/g, ' ')}</p>
                  <p className="text-fg-muted text-xs">{doc.fileName}</p>
                  {doc.reviewNote && (
                    <p className="text-fg-muted text-xs italic">{doc.reviewNote}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {doc.reviewStatus === 'ACCEPTED' && <Badge tone="success">Accepted</Badge>}
                  {doc.reviewStatus === 'REJECTED' && <Badge tone="danger">Rejected</Badge>}
                  {doc.reviewStatus === 'PENDING' && <Badge tone="neutral">Pending</Badge>}
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={pending === `doc-${doc.id}`}
                    onClick={() => void getDocUrl(doc.id)}
                    rightIcon={<ExternalLink className="size-3.5" />}
                  >
                    View
                  </Button>
                  {doc.reviewStatus !== 'ACCEPTED' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={pending === `doc-${doc.id}`}
                      onClick={() => void reviewDoc(doc.id, 'ACCEPTED')}
                    >
                      Accept
                    </Button>
                  )}
                  {doc.reviewStatus !== 'REJECTED' && (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={pending === `doc-${doc.id}`}
                      onClick={() => void reviewDoc(doc.id, 'REJECTED')}
                    >
                      Reject
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {isClaimed && (
        <section className="border-border bg-surface grid gap-4 rounded-xl border p-5">
          <h2 className="text-fg font-semibold">Verification actions</h2>

          {!showInfoForm && !showRejectForm && (
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                leftIcon={<AlertCircle />}
                onClick={() => setShowInfoForm(true)}
              >
                Request more info
              </Button>
              <Button
                variant="primary"
                leftIcon={<CheckCircle2 />}
                loading={pending === 'verify'}
                onClick={() => void verify()}
              >
                Approve & verify
              </Button>
              <Button
                variant="danger"
                leftIcon={<XCircle />}
                onClick={() => setShowRejectForm(true)}
              >
                Reject
              </Button>
            </div>
          )}

          {showInfoForm && (
            <div className="grid gap-3">
              <FormField label="What information do you need from the employer?" required>
                <Textarea
                  rows={3}
                  value={infoText}
                  onChange={(e) => setInfoText(e.target.value)}
                  placeholder="Describe what is missing or unclear…"
                />
              </FormField>
              <div className="flex gap-2">
                <Button
                  loading={pending === 'request-info'}
                  disabled={infoText.trim().length < 10}
                  leftIcon={<ClipboardList />}
                  onClick={() => void requestInfo()}
                >
                  Send request
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowInfoForm(false);
                    setInfoText('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {showRejectForm && (
            <div className="grid gap-3">
              <FormField label="Rejection reason" required>
                <Select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  options={REJECTION_REASONS}
                  placeholder="Choose a reason"
                />
              </FormField>
              <FormField label="Note (optional)">
                <Textarea
                  rows={2}
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                />
              </FormField>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  loading={pending === 'reject'}
                  disabled={!rejectReason}
                  leftIcon={<XCircle />}
                  onClick={() => void reject()}
                >
                  Confirm rejection
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowRejectForm(false);
                    setRejectReason('');
                    setRejectNote('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
