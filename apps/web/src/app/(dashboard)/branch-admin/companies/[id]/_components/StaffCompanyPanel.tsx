'use client';

import {
  COMPANY_SIZE_BANDS,
  COMPANY_SIZE_LABELS,
  LEGAL_STRUCTURE_LABELS,
  LEGAL_STRUCTURES,
  type CompanySizeBand,
  type CompanyStatus,
  type LegalStructure,
} from '@jobbank/shared';
import { ArrowLeft, ExternalLink, Pause, Pencil, Play, PlusCircle, Printer } from 'lucide-react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Input, Link, Select, StatusPill, Textarea } from '@/components/atoms';
import { FormField, KeyValue } from '@/components/molecules';
import { apiFetch, friendlyApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { putWithProgress } from '@/lib/upload/put-with-progress';
import type { CompanyOnboarding, CompanyView } from '@/domains/company';
import type { JobView } from '@/domains/job';
import { CompanyRegistrationFormPrint } from '@/app/(dashboard)/_components/companies/CompanyRegistrationFormPrint';
import { JobManagementPanel } from '@/app/(dashboard)/_components/jobs/JobManagementPanel';

interface MasterDataOption {
  id: string;
  code: string;
  label: string;
  parentId: string | null;
}

interface GeocodeResult {
  lat: number;
  lng: number;
  addressLine: string;
  cityCode: string | null;
  cityLabel: string | null;
  display: string;
}

const STATUS_PILL: Record<
  CompanyStatus,
  {
    label: string;
    variant: 'success' | 'danger' | 'warning' | 'neutral' | 'info';
  }
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
  onboarding,
  canSuspend,
  canManage,
  canOnboard = false,
  canVerify = false,
  jobs,
  canManageJobs,
  categories,
}: {
  company: CompanyView;
  onboarding?: CompanyOnboarding | null;
  canSuspend: boolean;
  canManage: boolean;
  canOnboard?: boolean;
  /** Branch Admin review: verify, reject, request info, review documents. */
  canVerify?: boolean;
  jobs: JobView[];
  canManageJobs: boolean;
  categories: { code: string; label: string }[];
}) {
  const pathname = usePathname();
  const isVerifierRoute = pathname.includes('/verifier/');
  const isBranchAdminRoute = pathname.includes('/branch-admin/');
  const backHref = pathname.includes('super-admin')
    ? '/super-admin/companies'
    : pathname.includes('/verifier/')
      ? '/verifier/companies'
      : pathname.includes('/staff/')
        ? '/staff/jobs'
        : '/branch-admin/companies';
  // "Post a job" goes to the current role's job-creation route with this
  // company preselected. Super Admin has no job:manage and no jobs/new
  // route, so no button there. Branch Admin can no longer post jobs
  // (2026-11-12), so no button there either. Only VERIFIED companies
  // can take jobs (C1).
  const postJobHref =
    company.status === 'VERIFIED'
      ? pathname.includes('/verifier/')
        ? `/verifier/jobs/new?companyId=${company.id}`
        : pathname.includes('/staff/')
          ? `/staff/jobs/new?companyId=${company.id}`
          : null
      : null;
  const [company_, setCompany_] = useState(company);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suspendNote, setSuspendNote] = useState('');
  const [showSuspendForm, setShowSuspendForm] = useState(false);
  const [resubmitNote, setResubmitNote] = useState('');
  const [showResubmitForm, setShowResubmitForm] = useState(false);
  const [printReady, setPrintReady] = useState(false);
  // True once the print form's QR code and logo have settled. The Print
  // button stays disabled until then — and until the industry label fetch
  // has settled too, or the form prints the raw industry code.
  const [printLabelsReady, setPrintLabelsReady] = useState(false);
  const [industriesSettled, setIndustriesSettled] = useState(false);
  const [verifiedSigned, setVerifiedSigned] = useState(
    Boolean(company.registrationVerifiedSignedAt),
  );
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  // Onboard upload (F1): for an onboarded DRAFT that has not been marked
  // verified & signed yet — the same condition as the verified-signed button —
  // and while the company is INFO_REQUESTED, when the Branch Admin asked for
  // more and the onboarder is supplying it.
  const canUploadDocs = Boolean(
    canOnboard &&
    onboarding &&
    ((company_.status === 'DRAFT' && !verifiedSigned) || company_.status === 'INFO_REQUESTED'),
  );
  const canUploadCompanyDocuments = Boolean(company_.headOffice && company_.branch);
  const hasRequiredDocumentForSignature =
    company_.requiredDocuments.length === 0 ||
    company_.requiredDocuments.some((code) =>
      company_.documents.some(
        (document) => document.typeCode === code && document.reviewStatus !== 'REJECTED',
      ),
    );
  const [industries, setIndustries] = useState<MasterDataOption[]>([]);
  const [cities, setCities] = useState<MasterDataOption[]>([]);
  // Head office form (H3): the onboard form only records the address as a
  // note, so onboarded companies reach review with no location row.
  const [showHqForm, setShowHqForm] = useState(false);
  const [hqAddress, setHqAddress] = useState('');
  const [hqCity, setHqCity] = useState('');
  const [hqArea, setHqArea] = useState('');
  const [hqLat, setHqLat] = useState(0);
  const [hqLng, setHqLng] = useState(0);
  const [hqSearch, setHqSearch] = useState('');
  const [hqSuggestions, setHqSuggestions] = useState<GeocodeResult[]>([]);
  const [hqSearching, setHqSearching] = useState(false);
  const [showHqSuggestions, setShowHqSuggestions] = useState(false);
  const hqDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPrintReady(true);
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch<MasterDataOption[]>('/api/v1/master-data?type=INDUSTRY')
      .then(({ data }) => {
        if (active) setIndustries(data ?? []);
      })
      .catch(() => {
        // Industry label falls back to the raw industry code on the print form.
      })
      .finally(() => {
        if (active) setIndustriesSettled(true);
      });
    apiFetch<MasterDataOption[]>('/api/v1/master-data?type=CITY')
      .then(({ data }) => {
        if (active) setCities(data ?? []);
      })
      .catch(() => {
        // City select falls back to an empty list; the head-office form stays unusable until it loads.
      });
    return () => {
      active = false;
    };
  }, []);

  const industryLabel =
    industries.find((i) => i.code === company_.details.industryCode)?.label ?? null;

  const pill = STATUS_PILL[company_.status];

  async function changeStatus(status: 'SUSPENDED' | 'VERIFIED', note?: string) {
    setPending(status);
    setError(null);
    // L10: the status route requires an Idempotency-Key — one fresh key per
    // submit, so a retried click replays instead of double-applying.
    // Found while wiring it: the call used to send `note`, but the route
    // requires `reason` (min 5 chars), so every suspend/reinstate from this
    // panel 422'd. Suspend needs a typed reason; reinstate records a fixed
    // one — there is no note field on the reinstate button.
    const reason = status === 'SUSPENDED' ? (note ?? '').trim() : 'Company reinstated';
    if (reason.length < 5) {
      setError('Add a reason for this change (at least 5 characters) — it is recorded.');
      setPending(null);
      return;
    }
    try {
      const { data: saved } = await apiFetch<CompanyView>(
        `/api/v1/companies/${company_.id}/status`,
        {
          method: 'PATCH',
          body: { status, reason },
          idempotencyKey: crypto.randomUUID(),
        },
      );
      setCompany_(saved);
      setShowSuspendForm(false);
      setSuspendNote('');
    } catch (err) {
      setError(friendlyApiError(err));
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
    } catch (err) {
      setError(friendlyApiError(err));
    }
  }

  /**
   * Staff document upload: presign → PUT to the app's upload route → confirm.
   * Size and type are enforced server-side by the presign step; a rejected file surfaces the server's message in the panel error banner.
   * Uploading a file of a type that already has one replaces it on confirm.
   */
  async function uploadDocument(typeCode: string, file: File) {
    setUploadingDoc(typeCode);
    setError(null);
    try {
      const { data: presign } = await apiFetch<{
        documentId: string;
        upload: { url: string; headers: Record<string, string> };
      }>(`/api/v1/companies/${company_.id}/documents`, {
        method: 'POST',
        body: { typeCode, fileName: file.name, contentType: file.type, sizeBytes: file.size },
      });
      await putWithProgress({ url: presign.upload.url, file, headers: presign.upload.headers });
      const { data: saved } = await apiFetch<CompanyView>(
        `/api/v1/companies/${company_.id}/documents/${presign.documentId}/confirm`,
        { method: 'POST' },
      );
      setCompany_(saved);
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setUploadingDoc(null);
    }
  }

  // ─── Branch Admin review (2026-11-14: verification moved from Verifier
  // to Branch Admin) ─────────────────────────────────────────────────
  // Reviewable while the company still awaits a decision. The server
  // re-checks permission, branch scope and the state machine; these buttons
  // are only the visible half of the check.
  const REVIEWABLE_STATUSES: CompanyStatus[] = [
    'DRAFT',
    'SUBMITTED',
    'UNDER_VERIFICATION',
    'RESUBMITTED',
  ];
  const canReview = canVerify && REVIEWABLE_STATUSES.includes(company_.status);
  const requiredDocumentsToAccept = company_.requiredDocuments.filter(
    (code) =>
      !company_.documents.some(
        (document) => document.typeCode === code && document.reviewStatus === 'ACCEPTED',
      ),
  );
  const paperFormSignedForCurrentRound =
    !onboarding ||
    Boolean(
      company_.registrationVerifiedSignedAt &&
      (!company_.verification ||
        company_.registrationVerifiedSignedAt >= company_.verification.submittedAt),
    );
  const canFinalizeReturnedOnboarding = Boolean(
    isBranchAdminRoute && canVerify && onboarding && company_.status === 'RESUBMITTED',
  );
  const canAcceptResubmission = Boolean(
    isBranchAdminRoute && canVerify && company_.status === 'RESUBMITTED',
  );
  const verificationBlockers = [
    ...(company_.contacts.some((contact) => contact.isPrimary)
      ? []
      : ['add a main contact person']),
    ...(!company_.headOffice || !company_.branch
      ? ['set the head office location and branch']
      : []),
    ...requiredDocumentsToAccept.map((code) => {
      const current = company_.documents.find((document) => document.typeCode === code);
      return current && current.reviewStatus !== 'REJECTED'
        ? `accept ${code.replace(/_/g, ' ')}`
        : `upload ${code.replace(/_/g, ' ')}`;
    }),
    ...(paperFormSignedForCurrentRound || canFinalizeReturnedOnboarding
      ? []
      : ['mark the paper registration form verified and signed']),
  ];
  const canDirectlyVerifyOnboardedDraft = Boolean(
    isBranchAdminRoute && canVerify && onboarding && company_.status === 'DRAFT',
  );
  const canVerifyCompany = canDirectlyVerifyOnboardedDraft || verificationBlockers.length === 0;
  const [showInfoForm, setShowInfoForm] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [infoText, setInfoText] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [docRejectId, setDocRejectId] = useState<string | null>(null);
  const [docRejectNote, setDocRejectNote] = useState('');

  async function callReviewAction(action: string, body?: Record<string, unknown>) {
    setPending(action);
    setError(null);
    try {
      const { data: saved } = await apiFetch<CompanyView>(
        `/api/v1/companies/${company_.id}/${action}`,
        { method: 'POST', body, idempotencyKey: crypto.randomUUID() },
      );
      setCompany_(saved);
      setVerifiedSigned(Boolean(saved.registrationVerifiedSignedAt));
      setShowInfoForm(false);
      setShowRejectForm(false);
      setInfoText('');
      setRejectReason('');
      setRejectNote('');
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setPending(null);
    }
  }

  async function reviewDoc(docId: string, decision: 'ACCEPTED' | 'REJECTED', note?: string) {
    setPending(`doc-${docId}`);
    setError(null);
    try {
      const { data: saved } = await apiFetch<CompanyView>(
        `/api/v1/companies/${company_.id}/documents/${docId}/review`,
        {
          method: 'PATCH',
          body: { decision, note: note ?? null },
          idempotencyKey: crypto.randomUUID(),
        },
      );
      setCompany_(saved);
      setDocRejectId(null);
      setDocRejectNote('');
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setPending(null);
    }
  }

  async function markAsVerifiedSigned() {
    setPending('verified-signed');
    setError(null);
    try {
      const { data } = await apiFetch<{
        verifiedSigned: boolean;
        status: string;
        company: CompanyView;
      }>(`/api/v1/companies/${company_.id}/registration-form/verified-signed`, { method: 'POST' });
      setCompany_(data.company);
      setVerifiedSigned(true);
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setPending(null);
    }
  }

  function onHqSearchChange(value: string) {
    setHqSearch(value);
    if (hqDebounceRef.current) clearTimeout(hqDebounceRef.current);
    if (value.trim().length < 3) {
      setHqSuggestions([]);
      setShowHqSuggestions(false);
      return;
    }
    hqDebounceRef.current = setTimeout(async () => {
      setHqSearching(true);
      try {
        const { data } = await apiFetch<GeocodeResult[]>(
          `/api/v1/geocode/search?q=${encodeURIComponent(value)}`,
        );
        setHqSuggestions(data ?? []);
        setShowHqSuggestions((data ?? []).length > 0);
      } catch {
        setHqSuggestions([]);
        setShowHqSuggestions(false);
      } finally {
        setHqSearching(false);
      }
    }, 500);
  }

  function pickHqSuggestion(r: GeocodeResult) {
    setHqLat(r.lat);
    setHqLng(r.lng);
    setHqAddress(r.addressLine);
    setHqSearch(r.addressLine);
    if (r.cityCode && cities.some((c) => c.code === r.cityCode)) setHqCity(r.cityCode);
    setHqSuggestions([]);
    setShowHqSuggestions(false);
  }

  async function saveHeadOffice() {
    setPending('head-office');
    setError(null);
    try {
      const { data: saved } = await apiFetch<CompanyView>(
        `/api/v1/companies/${company_.id}/head-office`,
        {
          method: 'POST',
          body: {
            location: { lat: hqLat, lng: hqLng },
            addressLine: hqAddress,
            cityCode: hqCity,
            areaCode: hqArea || undefined,
          },
        },
      );
      setCompany_(saved);
      setShowHqForm(false);
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setPending(null);
    }
  }

  async function resubmitOnboarded() {
    setPending('resubmit');
    setError(null);
    try {
      const { data: saved } = await apiFetch<CompanyView>(
        `/api/v1/companies/${company_.id}/resubmit`,
        { method: 'POST', body: { note: resubmitNote.trim() || null } },
      );
      setCompany_(saved);
      setShowResubmitForm(false);
      setResubmitNote('');
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setPending(null);
    }
  }

  // Correct locked details (company:manage): only the fields that changed
  // are sent, plus the mandatory audit reason.
  const [showCorrectForm, setShowCorrectForm] = useState(false);
  const [correct, setCorrect] = useState({
    legalName: '',
    tradeName: '',
    legalStructure: 'PRIVATE_LIMITED' as LegalStructure,
    ntn: '',
    registrationNo: '',
    industryCode: '',
    sizeBand: '1_10' as CompanySizeBand,
    website: '',
    description: '',
  });
  const [correctReason, setCorrectReason] = useState('');

  function openCorrectForm() {
    setCorrect({
      legalName: company_.details.legalName,
      tradeName: company_.details.tradeName ?? '',
      legalStructure: company_.details.legalStructure,
      ntn: company_.details.ntn ?? '',
      registrationNo: company_.details.registrationNo ?? '',
      industryCode: company_.details.industryCode,
      sizeBand: company_.details.sizeBand,
      website: company_.details.website ?? '',
      description: company_.details.description ?? '',
    });
    setCorrectReason('');
    setError(null);
    setShowCorrectForm(true);
  }

  async function saveCorrectDetails() {
    const changes: Record<string, string> = {};
    const d = company_.details;
    if (correct.legalName.trim() !== d.legalName) changes.legalName = correct.legalName.trim();
    if (correct.tradeName.trim() !== (d.tradeName ?? ''))
      changes.tradeName = correct.tradeName.trim();
    if (correct.legalStructure !== d.legalStructure)
      changes.legalStructure = correct.legalStructure;
    // A blank NTN is not a change (staff onboarding leaves it blank); the
    // update schema has no way to clear an NTN, so only a filled value counts.
    if (correct.ntn.trim() !== (d.ntn ?? '') && correct.ntn.trim() !== '')
      changes.ntn = correct.ntn.trim();
    if (correct.registrationNo.trim() !== (d.registrationNo ?? ''))
      changes.registrationNo = correct.registrationNo.trim();
    if (correct.industryCode !== d.industryCode) changes.industryCode = correct.industryCode;
    if (correct.sizeBand !== d.sizeBand) changes.sizeBand = correct.sizeBand;
    if (correct.website.trim() !== (d.website ?? '')) changes.website = correct.website.trim();
    if (correct.description.trim() !== (d.description ?? ''))
      changes.description = correct.description.trim();
    if (Object.keys(changes).length === 0) {
      setError('Change at least one field.');
      return;
    }
    if (correctReason.trim().length === 0) {
      setError('Add a reason for this correction — it is recorded in the audit log.');
      return;
    }
    setPending('correct');
    setError(null);
    try {
      const { data: saved } = await apiFetch<CompanyView>(`/api/v1/companies/${company_.id}`, {
        method: 'PATCH',
        body: { ...changes, reason: correctReason.trim() },
        // L10: the correct-details route requires an Idempotency-Key — one
        // fresh key per submit, so a retried correction replays instead of
        // double-applying.
        idempotencyKey: crypto.randomUUID(),
      });
      setCompany_(saved);
      setShowCorrectForm(false);
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setPending(null);
    }
  }

  const industryOptions = industries.map((i) => ({ value: i.code, label: i.label }));
  if (correct.industryCode && !industryOptions.some((o) => o.value === correct.industryCode)) {
    industryOptions.unshift({ value: correct.industryCode, label: correct.industryCode });
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
            {isVerifierRoute && company_.status === 'INFO_REQUESTED' && (
              <p className="text-fg-muted mt-1 text-sm">
                Save the requested information to automatically return the company to the Branch
                Admin for review. The Branch Admin can request more information if anything is
                missing.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {canAcceptResubmission && (
              <Button
                loading={pending === 'verify'}
                onClick={() => void callReviewAction('verify', { note: null })}
              >
                Accept resubmission
              </Button>
            )}
            {postJobHref && (
              <Link href={postJobHref}>
                <Button size="sm">
                  <PlusCircle className="mr-1.5 size-4" />
                  Post a job
                </Button>
              </Link>
            )}
            {onboarding && !isVerifierRoute && !isBranchAdminRoute && (
              <Button
                variant="secondary"
                leftIcon={<Printer />}
                onClick={() => window.print()}
                disabled={!printLabelsReady || !industriesSettled}
              >
                {printLabelsReady && industriesSettled
                  ? 'Print registration form'
                  : 'Preparing print…'}
              </Button>
            )}
            {!isVerifierRoute &&
              (!isBranchAdminRoute || canVerify) &&
              canOnboard &&
              onboarding &&
              company_.status === 'DRAFT' &&
              !verifiedSigned && (
                <Button
                  loading={pending === (isBranchAdminRoute ? 'verify' : 'verified-signed')}
                  disabled={!isBranchAdminRoute && !hasRequiredDocumentForSignature}
                  onClick={() =>
                    isBranchAdminRoute
                      ? void callReviewAction('verify', { note: null })
                      : void markAsVerifiedSigned()
                  }
                >
                  Mark as verified &amp; signed
                </Button>
              )}
            {canOnboard &&
              !isVerifierRoute &&
              onboarding &&
              company_.status === 'INFO_REQUESTED' &&
              !showResubmitForm && (
                <Button loading={pending === 'resubmit'} onClick={() => setShowResubmitForm(true)}>
                  Send back for review
                </Button>
              )}
            {canManage &&
              (!isVerifierRoute || company_.status === 'INFO_REQUESTED') &&
              !showCorrectForm && (
                <Button variant="secondary" leftIcon={<Pencil />} onClick={openCorrectForm}>
                  Correct details
                </Button>
              )}
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

      {verifiedSigned && (
        <div className="bg-success-soft text-success-soft-fg rounded-xl px-4 py-3 text-sm">
          {company_.status === 'VERIFIED'
            ? 'The company has been verified and the registration form signed.'
            : 'Verification and signature recorded. The company is now submitted for Branch Admin review.'}
        </div>
      )}

      {canReview && (
        <section className="border-border bg-surface grid gap-4 rounded-xl border p-5">
          <h2 className="text-fg font-semibold">Review &amp; verify</h2>
          <p className="text-fg-muted text-sm">
            {company_.status === 'DRAFT'
              ? 'This company was registered by a Verification Officer and is waiting for your review. Verify it once the documents below are accepted and the details check out.'
              : 'Review the documents below, then verify, ask for more information, or reject.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {!canAcceptResubmission && !canFinalizeReturnedOnboarding && (
              <Button
                loading={pending === 'verify'}
                disabled={!canVerifyCompany}
                onClick={() => void callReviewAction('verify', { note: null })}
              >
                Verify company
              </Button>
            )}
            {!showInfoForm && (
              <Button variant="secondary" onClick={() => setShowInfoForm(true)}>
                Request more info
              </Button>
            )}
            {!showRejectForm && (
              <Button variant="danger" onClick={() => setShowRejectForm(true)}>
                Reject
              </Button>
            )}
          </div>
          {!canVerifyCompany && !canDirectlyVerifyOnboardedDraft && (
            <p className="text-fg-muted text-sm" role="status">
              {canAcceptResubmission
                ? 'Accepting this resubmission will verify the company despite:'
                : 'Before verifying,'}{' '}
              {verificationBlockers.join('; ')}.
            </p>
          )}
          {showInfoForm && (
            <div className="grid gap-2">
              <FormField label="What information do you need?" required>
                <Textarea
                  rows={3}
                  value={infoText}
                  onChange={(e) => setInfoText(e.target.value)}
                  placeholder="Say what is missing, so the company can fix it…"
                />
              </FormField>
              <div className="flex gap-2">
                <Button
                  loading={pending === 'request-info'}
                  disabled={infoText.trim().length < 10}
                  onClick={() => void callReviewAction('request-info', { note: infoText.trim() })}
                >
                  Send request
                </Button>
                <Button
                  variant="ghost"
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
            <div className="grid gap-2">
              <FormField label="Reason" required>
                <Select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  options={[
                    { value: '', label: 'Choose a reason' },
                    { value: 'INVALID_DOCUMENTS', label: 'Invalid or forged documents' },
                    { value: 'DUPLICATE_REGISTRATION', label: 'Duplicate company' },
                    { value: 'OTHER', label: 'Other' },
                  ]}
                />
              </FormField>
              <FormField label="Note" required>
                <Textarea
                  rows={3}
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Explain the decision (at least 10 characters)…"
                />
              </FormField>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  loading={pending === 'reject'}
                  disabled={!rejectReason || rejectNote.trim().length < 10}
                  onClick={() =>
                    void callReviewAction('reject', {
                      reasonCode: rejectReason,
                      note: rejectNote.trim(),
                    })
                  }
                >
                  Reject company
                </Button>
                <Button
                  variant="ghost"
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

      {canOnboard &&
        onboarding &&
        !company_.headOffice &&
        (company_.status === 'DRAFT' || company_.status === 'INFO_REQUESTED') && (
          <section className="border-border bg-surface grid gap-4 rounded-xl border p-5">
            <h2 className="text-fg font-semibold">Head office</h2>
            {!showHqForm ? (
              <>
                <p className="text-fg-muted text-sm">
                  A head office location is needed before this company can be verified.
                  {onboarding.notes.headOfficeAddress
                    ? ` The visit notes record: ${onboarding.notes.headOfficeAddress}`
                    : ' No address was recorded at the visit.'}
                </p>
                <div>
                  <Button onClick={() => setShowHqForm(true)}>Add head office</Button>
                </div>
              </>
            ) : (
              <form
                className="grid gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveHeadOffice();
                }}
              >
                <div className="relative">
                  <FormField label="Search address" required>
                    <Input
                      placeholder="Type the office address, e.g. Gulshan-e-Iqbal, Karachi"
                      value={hqSearch}
                      onChange={(e) => onHqSearchChange(e.target.value)}
                      onBlur={() => setTimeout(() => setShowHqSuggestions(false), 150)}
                      onFocus={() => hqSuggestions.length > 0 && setShowHqSuggestions(true)}
                    />
                  </FormField>
                  {hqSearching && <p className="text-fg-muted mt-1 text-xs">Searching…</p>}
                  {showHqSuggestions && (
                    <ul className="border-border bg-surface absolute top-full z-10 mt-1 w-full overflow-hidden rounded-xl border shadow-lg">
                      {hqSuggestions.map((r, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            className="hover:bg-surface-muted w-full px-4 py-2.5 text-left text-sm"
                            onMouseDown={() => pickHqSuggestion(r)}
                          >
                            {r.display}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {hqLat !== 0 && hqLng !== 0 && (
                  <p className="text-fg-muted text-xs">
                    Coordinates: {hqLat.toFixed(6)}, {hqLng.toFixed(6)}
                  </p>
                )}
                <FormField label="Full address" required>
                  <Input
                    placeholder="Building name, street, area"
                    value={hqAddress}
                    onChange={(e) => setHqAddress(e.target.value)}
                  />
                </FormField>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="City" required>
                    <Select
                      value={hqCity}
                      onChange={(e) => setHqCity(e.target.value)}
                      options={cities.map((c) => ({ value: c.code, label: c.label }))}
                      placeholder="Choose a city"
                    />
                  </FormField>
                  <FormField label="Area">
                    <Input
                      placeholder="e.g. Gulshan-e-Iqbal"
                      value={hqArea}
                      onChange={(e) => setHqArea(e.target.value)}
                    />
                  </FormField>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    loading={pending === 'head-office'}
                    disabled={
                      !(hqLat !== 0 && hqLng !== 0 && hqAddress.trim().length >= 5 && hqCity)
                    }
                  >
                    Save head office
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowHqForm(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </section>
        )}

      {showSuspendForm && (
        <div className="border-border bg-surface grid gap-3 rounded-xl border p-5">
          <h2 className="text-fg font-semibold">Suspend company</h2>
          <FormField label="Reason for suspension (required — shown to the employer, recorded in the audit log)">
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

      {showResubmitForm && (
        <div className="border-border bg-surface grid gap-3 rounded-xl border p-5">
          <h2 className="text-fg font-semibold">Send back for review</h2>
          <p className="text-fg-muted text-sm">
            The Branch Admin asked for more information. If you already uploaded the document or
            edited the details, you can send it back as-is — otherwise say what you changed or sent
            (at least 10 characters).
          </p>
          <FormField label="Note for the Branch Admin (optional — required when nothing changed)">
            <Textarea
              rows={2}
              value={resubmitNote}
              onChange={(e) => setResubmitNote(e.target.value)}
            />
          </FormField>
          <div className="flex gap-2">
            <Button loading={pending === 'resubmit'} onClick={() => void resubmitOnboarded()}>
              Send back
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setShowResubmitForm(false);
                setResubmitNote('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {showCorrectForm && (
        <div className="border-border bg-surface grid gap-3 rounded-xl border p-5">
          <h2 className="text-fg font-semibold">Correct company details</h2>
          <p className="text-fg-muted text-sm">
            Only the fields you change are saved. The reason is recorded in the audit log.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Registered company name" required>
              <Input
                value={correct.legalName}
                onChange={(e) => setCorrect((c) => ({ ...c, legalName: e.target.value }))}
              />
            </FormField>
            <FormField label="Trading name">
              <Input
                value={correct.tradeName}
                onChange={(e) => setCorrect((c) => ({ ...c, tradeName: e.target.value }))}
              />
            </FormField>
            <FormField label="Type of business" required>
              <Select
                value={correct.legalStructure}
                onChange={(e) =>
                  setCorrect((c) => ({ ...c, legalStructure: e.target.value as LegalStructure }))
                }
                options={LEGAL_STRUCTURES.map((v) => ({
                  value: v,
                  label: LEGAL_STRUCTURE_LABELS[v],
                }))}
              />
            </FormField>
            <FormField label="NTN" required>
              <Input
                value={correct.ntn}
                onChange={(e) => setCorrect((c) => ({ ...c, ntn: e.target.value }))}
              />
            </FormField>
            <FormField label="Registration no.">
              <Input
                value={correct.registrationNo}
                onChange={(e) => setCorrect((c) => ({ ...c, registrationNo: e.target.value }))}
              />
            </FormField>
            <FormField label="Industry" required>
              <Select
                value={correct.industryCode}
                onChange={(e) => setCorrect((c) => ({ ...c, industryCode: e.target.value }))}
                options={industryOptions}
              />
            </FormField>
            <FormField label="Company size" required>
              <Select
                value={correct.sizeBand}
                onChange={(e) =>
                  setCorrect((c) => ({ ...c, sizeBand: e.target.value as CompanySizeBand }))
                }
                options={COMPANY_SIZE_BANDS.map((v) => ({
                  value: v,
                  label: COMPANY_SIZE_LABELS[v],
                }))}
              />
            </FormField>
            <FormField label="Website">
              <Input
                value={correct.website}
                onChange={(e) => setCorrect((c) => ({ ...c, website: e.target.value }))}
              />
            </FormField>
            <FormField label="About the company" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={correct.description}
                onChange={(e) => setCorrect((c) => ({ ...c, description: e.target.value }))}
              />
            </FormField>
            <FormField label="Reason for this correction" required className="sm:col-span-2">
              <Textarea
                rows={2}
                value={correctReason}
                onChange={(e) => setCorrectReason(e.target.value)}
              />
            </FormField>
          </div>
          <div className="flex gap-2">
            <Button loading={pending === 'correct'} onClick={() => void saveCorrectDetails()}>
              Save correction
            </Button>
            <Button variant="secondary" onClick={() => setShowCorrectForm(false)}>
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
            {
              label: 'Reg. no.',
              value: company_.details.registrationNo ?? '—',
            },
            {
              label: 'Structure',
              value: LEGAL_STRUCTURE_LABELS[company_.details.legalStructure],
            },
            {
              label: 'Size',
              value: COMPANY_SIZE_LABELS[company_.details.sizeBand],
            },
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

      {onboarding && (
        <section className="border-border bg-surface grid gap-4 rounded-xl border p-5">
          <h2 className="text-fg font-semibold">Onboarding</h2>
          <KeyValue
            columns={2}
            items={[
              {
                label: 'Onboarded by',
                value: onboarding.onboardedBy
                  ? `${onboarding.onboardedBy.name ?? ''}${onboarding.onboardedBy.roleLabel ? ` (${onboarding.onboardedBy.roleLabel})` : ''}`
                  : '—',
              },
              {
                label: 'Visit date',
                value: onboarding.visitDate ? formatDate(onboarding.visitDate) : '—',
              },
              {
                label: 'Registration form',
                value: company_.registrationVerifiedSignedAt
                  ? `Verified & signed ${formatDate(company_.registrationVerifiedSignedAt)}`
                  : 'Not yet verified & signed',
              },
              { label: 'Head-office address', value: onboarding.notes.headOfficeAddress ?? '—' },
              { label: 'Other sites', value: onboarding.notes.otherSites ?? '—' },
              { label: 'Additional notes', value: onboarding.notes.additionalNotes ?? '—' },
            ]}
          />
        </section>
      )}

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

      {(company_.documents.length > 0 || canUploadDocs) && (
        <section
          id="company-documents"
          className="border-border bg-surface grid gap-4 rounded-xl border p-5"
        >
          <h2 className="text-fg font-semibold">Documents</h2>
          {canUploadDocs && (
            <p className="text-fg-muted text-sm">
              {company_.status === 'INFO_REQUESTED'
                ? 'The Branch Admin asked for more — upload the missing documents here, then send the company back from the header.'
                : 'Upload the required documents before marking the form verified & signed. PDF, JPG or PNG — the file size and type are checked on upload. Uploading a file of a type that already has one replaces it.'}
            </p>
          )}
          {canUploadDocs && !canUploadCompanyDocuments && (
            <p className="text-fg-muted text-sm" role="status">
              Save the head office location above and make sure this company has a branch before
              uploading documents.
            </p>
          )}
          {canUploadDocs ? (
            <div className="grid gap-3">
              {company_.requiredDocuments.map((code) => {
                const current = company_.documents.find((d) => d.typeCode === code);
                return (
                  <div key={code} className="flex flex-wrap items-center justify-between gap-3">
                    <div className="grid gap-0.5">
                      <p className="text-fg text-sm font-medium">{code.replace(/_/g, ' ')}</p>
                      {current ? (
                        <p className="text-fg-muted text-xs">{current.fileName}</p>
                      ) : (
                        <p className="text-fg-muted text-xs">Not uploaded yet</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {current?.reviewStatus === 'ACCEPTED' && (
                        <Badge tone="success">Accepted</Badge>
                      )}
                      {current?.reviewStatus === 'REJECTED' && (
                        <Badge tone="danger">Rejected</Badge>
                      )}
                      {current?.reviewStatus === 'PENDING' && <Badge tone="neutral">Pending</Badge>}
                      {current && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void getDocUrl(current.id)}
                          rightIcon={<ExternalLink className="size-3.5" />}
                        >
                          View
                        </Button>
                      )}
                      {current && canReview && current.reviewStatus !== 'ACCEPTED' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={pending === `doc-${current.id}`}
                          onClick={() => void reviewDoc(current.id, 'ACCEPTED')}
                        >
                          Accept
                        </Button>
                      )}
                      {current && canReview && current.reviewStatus !== 'REJECTED' && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            setDocRejectId(current.id);
                            setDocRejectNote('');
                          }}
                        >
                          Reject
                        </Button>
                      )}
                      {uploadingDoc === code ? (
                        <span className="text-fg-muted text-sm">Uploading…</span>
                      ) : (
                        <input
                          type="file"
                          id={`company-doc-upload-${code}`}
                          name={`company-doc-upload-${code}`}
                          accept="application/pdf,image/jpeg,image/png"
                          disabled={uploadingDoc !== null || !canUploadCompanyDocuments}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) void uploadDocument(code, file);
                          }}
                          className="text-fg-muted text-sm"
                        />
                      )}
                    </div>
                    {current && docRejectId === current.id && (
                      <div className="grid w-full gap-2">
                        <FormField label="Why is this document not accepted?" required>
                          <Textarea
                            rows={2}
                            value={docRejectNote}
                            onChange={(e) => setDocRejectNote(e.target.value)}
                            placeholder="Say what is wrong, so the company can fix it…"
                          />
                        </FormField>
                        <div className="flex gap-2">
                          <Button
                            variant="danger"
                            size="sm"
                            loading={pending === `doc-${current.id}`}
                            disabled={docRejectNote.trim().length < 5}
                            onClick={() =>
                              void reviewDoc(current.id, 'REJECTED', docRejectNote.trim())
                            }
                          >
                            Send rejection
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDocRejectId(null);
                              setDocRejectNote('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {company_.requiredDocuments.length === 0 && (
                <p className="text-fg-muted text-sm">
                  No documents required for this business type yet.
                </p>
              )}
              {company_.documents
                .filter((d) => !company_.requiredDocuments.includes(d.typeCode))
                .map((doc) => (
                  <div key={doc.id} className="flex flex-wrap items-center justify-between gap-3">
                    <div className="grid gap-0.5">
                      <p className="text-fg text-sm font-medium">
                        {doc.typeCode.replace(/_/g, ' ')}
                      </p>
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
                      {canReview && doc.reviewStatus !== 'ACCEPTED' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={pending === `doc-${doc.id}`}
                          onClick={() => void reviewDoc(doc.id, 'ACCEPTED')}
                        >
                          Accept
                        </Button>
                      )}
                      {canReview && doc.reviewStatus !== 'REJECTED' && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            setDocRejectId(doc.id);
                            setDocRejectNote('');
                          }}
                        >
                          Reject
                        </Button>
                      )}
                    </div>
                    {docRejectId === doc.id && (
                      <div className="grid w-full gap-2">
                        <FormField label="Why is this document not accepted?" required>
                          <Textarea
                            rows={2}
                            value={docRejectNote}
                            onChange={(e) => setDocRejectNote(e.target.value)}
                            placeholder="Say what is wrong, so the company can fix it…"
                          />
                        </FormField>
                        <div className="flex gap-2">
                          <Button
                            variant="danger"
                            size="sm"
                            loading={pending === `doc-${doc.id}`}
                            disabled={docRejectNote.trim().length < 5}
                            onClick={() => void reviewDoc(doc.id, 'REJECTED', docRejectNote.trim())}
                          >
                            Send rejection
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDocRejectId(null);
                              setDocRejectNote('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            <div className="grid gap-3">
              {company_.documents.map((doc) => (
                <div key={doc.id} className="flex flex-wrap items-center justify-between gap-3">
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
                    {canReview && doc.reviewStatus !== 'ACCEPTED' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={pending === `doc-${doc.id}`}
                        onClick={() => void reviewDoc(doc.id, 'ACCEPTED')}
                      >
                        Accept
                      </Button>
                    )}
                    {canReview && doc.reviewStatus !== 'REJECTED' && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setDocRejectId(doc.id);
                          setDocRejectNote('');
                        }}
                      >
                        Reject
                      </Button>
                    )}
                  </div>
                  {docRejectId === doc.id && (
                    <div className="grid w-full gap-2">
                      <FormField label="Why is this document not accepted?" required>
                        <Textarea
                          rows={2}
                          value={docRejectNote}
                          onChange={(e) => setDocRejectNote(e.target.value)}
                          placeholder="Say what is wrong, so the company can fix it…"
                        />
                      </FormField>
                      <div className="flex gap-2">
                        <Button
                          variant="danger"
                          size="sm"
                          loading={pending === `doc-${doc.id}`}
                          disabled={docRejectNote.trim().length < 5}
                          onClick={() => void reviewDoc(doc.id, 'REJECTED', docRejectNote.trim())}
                        >
                          Send rejection
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setDocRejectId(null);
                            setDocRejectNote('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {onboarding && printReady
        ? createPortal(
            <CompanyRegistrationFormPrint
              key={company_.id}
              company={company_}
              onboarding={onboarding}
              industryLabel={industryLabel}
              onReady={() => setPrintLabelsReady(true)}
            />,
            document.body,
          )
        : null}
      <JobManagementPanel
        companyId={company_.id}
        jobs={jobs}
        categories={categories}
        canManage={canManageJobs}
        canCreate={company_.status === 'VERIFIED'}
        jobLinkBasePath={
          pathname.startsWith('/branch-admin/')
            ? `/branch-admin/companies/${company_.id}`
            : pathname.includes('/staff/')
              ? '/staff/jobs'
              : pathname.includes('/verifier/')
                ? '/verifier/jobs'
                : pathname.includes('super-admin')
                  ? '/super-admin/jobs'
                  : undefined
        }
      />
    </div>
  );
}
