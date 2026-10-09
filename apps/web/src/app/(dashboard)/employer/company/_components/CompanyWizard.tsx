'use client';

import {
  LEGAL_STRUCTURES,
  LEGAL_STRUCTURE_LABELS,
  COMPANY_SIZE_BANDS,
  COMPANY_SIZE_LABELS,
  COMPANY_STATUS_LABELS,
  type CompanyStatus,
} from '@jobbank/shared';
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button, Badge, Input, Select, StatusPill, Textarea } from '@/components/atoms';
import { FormField } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import type { CompanyView } from '@/domains/company/repository';

type WizardStep = 'details' | 'contacts' | 'location' | 'documents' | 'submit';

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'location', label: 'Location' },
  { id: 'documents', label: 'Documents' },
  { id: 'submit', label: 'Submit' },
];

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

function stepIndex(step: WizardStep) {
  return STEPS.findIndex((s) => s.id === step);
}

function nextStep(step: WizardStep): WizardStep | null {
  const idx = stepIndex(step);
  return idx < STEPS.length - 1 ? STEPS[idx + 1]!.id : null;
}

function prevStep(step: WizardStep): WizardStep | null {
  const idx = stepIndex(step);
  return idx > 0 ? STEPS[idx - 1]!.id : null;
}

// ─── Details step ──────────────────────────────────────────────────────

interface DetailsForm {
  legalName: string;
  tradeName: string;
  legalStructure: string;
  ntn: string;
  registrationNo: string;
  industryCode: string;
  sizeBand: string;
  website: string;
  description: string;
}

function DetailsStep({
  company,
  onSaved,
  idempotencyKey,
}: {
  company: CompanyView | null;
  onSaved: (c: CompanyView) => void;
  idempotencyKey: string;
}) {
  const d = company?.details;
  const [form, setForm] = useState<DetailsForm>({
    legalName: d?.legalName ?? '',
    tradeName: d?.tradeName ?? '',
    legalStructure: d?.legalStructure ?? '',
    ntn: d?.ntn ?? '',
    registrationNo: d?.registrationNo ?? '',
    industryCode: d?.industryCode ?? '',
    sizeBand: d?.sizeBand ?? '',
    website: d?.website ?? '',
    description: d?.description ?? '',
  });
  const [industries, setIndustries] = useState<{ code: string; label: string }[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ code: string; label: string }[]>('/api/v1/master-data?type=INDUSTRY')
      .then((res) => setIndustries(res.data))
      .catch(() => undefined);
  }, []);

  const set = (key: keyof DetailsForm) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const body = {
        legalName: form.legalName,
        tradeName: form.tradeName || undefined,
        legalStructure: form.legalStructure,
        ntn: form.ntn,
        registrationNo: form.registrationNo || undefined,
        industryCode: form.industryCode,
        sizeBand: form.sizeBand,
        website: form.website || undefined,
        description: form.description || undefined,
      };
      let saved: CompanyView;
      if (!company) {
        ({ data: saved } = await apiFetch<CompanyView>('/api/v1/companies/register', {
          method: 'POST',
          body,
          idempotencyKey,
        }));
      } else {
        ({ data: saved } = await apiFetch<CompanyView>('/api/v1/companies/me', {
          method: 'PATCH',
          body,
        }));
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  const isReady =
    form.legalName.trim().length >= 2 &&
    form.legalStructure &&
    form.ntn.trim().length >= 7 &&
    form.industryCode &&
    form.sizeBand;

  return (
    <form className="grid gap-4" onSubmit={(e) => void save(e)}>
      <FormField label="Registered company name" required>
        <Input value={form.legalName} onChange={(e) => set('legalName')(e.target.value)} />
      </FormField>
      <FormField label="Trading name" hint="Leave empty if trading under the registered name">
        <Input value={form.tradeName} onChange={(e) => set('tradeName')(e.target.value)} />
      </FormField>
      <FormField label="Business type" required>
        <Select
          value={form.legalStructure}
          onChange={(e) => set('legalStructure')(e.target.value)}
          options={LEGAL_STRUCTURES.map((s) => ({ value: s, label: LEGAL_STRUCTURE_LABELS[s] }))}
          placeholder="Choose a type"
        />
      </FormField>
      <FormField label="NTN (National Tax Number)" required hint="e.g. 1234567-8">
        <Input value={form.ntn} onChange={(e) => set('ntn')(e.target.value)} />
      </FormField>
      <FormField
        label="Registration / SECP number"
        hint="Required for private/public limited companies"
      >
        <Input
          value={form.registrationNo}
          onChange={(e) => set('registrationNo')(e.target.value)}
        />
      </FormField>
      <FormField label="Industry" required>
        <Select
          value={form.industryCode}
          onChange={(e) => set('industryCode')(e.target.value)}
          options={industries.map((i) => ({ value: i.code, label: i.label }))}
          placeholder="Choose an industry"
        />
      </FormField>
      <FormField label="Company size" required>
        <Select
          value={form.sizeBand}
          onChange={(e) => set('sizeBand')(e.target.value)}
          options={COMPANY_SIZE_BANDS.map((s) => ({ value: s, label: COMPANY_SIZE_LABELS[s] }))}
          placeholder="Choose a size"
        />
      </FormField>
      <FormField label="Website">
        <Input
          type="url"
          placeholder="https://example.com"
          value={form.website}
          onChange={(e) => set('website')(e.target.value)}
        />
      </FormField>
      <FormField label="About the company">
        <Textarea
          rows={3}
          value={form.description}
          onChange={(e) => set('description')(e.target.value)}
        />
      </FormField>
      {error && <p className="text-danger text-sm">{error}</p>}
      <Button
        type="submit"
        fullWidth
        loading={pending}
        disabled={!isReady}
        rightIcon={<ArrowRight />}
      >
        Save and continue
      </Button>
    </form>
  );
}

// ─── Contacts step ──────────────────────────────────────────────────────

interface ContactForm {
  name: string;
  designation: string;
  phone: string;
  email: string;
  isPrimary: boolean;
}

const emptyContact = (): ContactForm => ({
  name: '',
  designation: '',
  phone: '',
  email: '',
  isPrimary: false,
});

function ContactsStep({
  company,
  onSaved,
}: {
  company: CompanyView;
  onSaved: (c: CompanyView) => void;
}) {
  const [items, setItems] = useState<ContactForm[]>(
    company.contacts.length > 0
      ? company.contacts.map((c) => ({
          name: c.name,
          designation: c.designation ?? '',
          phone: c.phone,
          email: c.email ?? '',
          isPrimary: c.isPrimary,
        }))
      : [{ ...emptyContact(), isPrimary: true }],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateItem(index: number, key: keyof ContactForm, value: string | boolean) {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return key === 'isPrimary' && value ? { ...item, isPrimary: false } : item;
        return { ...item, [key]: value };
      }),
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data: saved } = await apiFetch<CompanyView>('/api/v1/companies/me/contacts', {
        method: 'PUT',
        body: {
          items: items.map((c) => ({
            name: c.name,
            designation: c.designation || undefined,
            phone: c.phone,
            email: c.email || undefined,
            isPrimary: c.isPrimary,
          })),
        },
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  const primaryCount = items.filter((i) => i.isPrimary).length;
  const isReady =
    items.length > 0 &&
    items.every((i) => i.name.trim().length >= 3 && i.phone.trim().length >= 10) &&
    primaryCount === 1;

  return (
    <form className="grid gap-6" onSubmit={(e) => void save(e)}>
      <p className="text-fg-muted text-sm">
        Add the people Job Bank can contact about your company. Mark one as the main contact.
      </p>
      {items.map((item, idx) => (
        <div key={idx} className="border-border grid gap-3 rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <span className="text-fg text-sm font-medium">Contact {idx + 1}</span>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <input
                  type="radio"
                  name="primary"
                  checked={item.isPrimary}
                  onChange={() => updateItem(idx, 'isPrimary', true)}
                />
                Main contact
              </label>
              {items.length > 1 && (
                <button
                  type="button"
                  className="text-danger text-xs underline"
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Full name" required>
              <Input value={item.name} onChange={(e) => updateItem(idx, 'name', e.target.value)} />
            </FormField>
            <FormField label="Designation">
              <Input
                value={item.designation}
                onChange={(e) => updateItem(idx, 'designation', e.target.value)}
              />
            </FormField>
            <FormField label="Phone" required>
              <Input
                type="tel"
                placeholder="0300 1234567"
                value={item.phone}
                onChange={(e) => updateItem(idx, 'phone', e.target.value)}
              />
            </FormField>
            <FormField label="Email">
              <Input
                type="email"
                value={item.email}
                onChange={(e) => updateItem(idx, 'email', e.target.value)}
              />
            </FormField>
          </div>
        </div>
      ))}
      {items.length < 5 && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setItems((prev) => [...prev, emptyContact()])}
        >
          Add another contact
        </Button>
      )}
      {error && <p className="text-danger text-sm">{error}</p>}
      <Button
        type="submit"
        fullWidth
        loading={pending}
        disabled={!isReady}
        rightIcon={<ArrowRight />}
      >
        Save and continue
      </Button>
    </form>
  );
}

// ─── Location step ──────────────────────────────────────────────────────

function LocationStep({
  company,
  onSaved,
}: {
  company: CompanyView;
  onSaved: (c: CompanyView) => void;
}) {
  const hq = company.headOffice;
  const [lat, setLat] = useState(hq?.location.lat.toString() ?? '');
  const [lng, setLng] = useState(hq?.location.lng.toString() ?? '');
  const [addressLine, setAddressLine] = useState(hq?.addressLine ?? '');
  const [cityCode, setCityCode] = useState(hq?.cityCode ?? '');
  const [areaCode, setAreaCode] = useState(hq?.areaCode ?? '');
  const [branchId, setBranchId] = useState(company.branch?.id ?? '');
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lat || !lng) return;
    apiFetch<{ id: string; name: string }[]>(
      `/api/v1/companies/me/branch-options?lat=${lat}&lng=${lng}`,
    )
      .then((res) => {
        setBranches(res.data);
        if (!branchId && res.data.length > 0) setBranchId(res.data[0]!.id);
      })
      .catch(() => undefined);
  }, [lat, lng]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data: saved } = await apiFetch<CompanyView>('/api/v1/companies/me/head-office', {
        method: 'PUT',
        body: {
          location: { lat: parseFloat(lat), lng: parseFloat(lng) },
          addressLine,
          cityCode,
          areaCode: areaCode || undefined,
          branchId,
        },
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  const isReady = lat && lng && addressLine.trim().length >= 5 && cityCode && branchId;

  return (
    <form className="grid gap-4" onSubmit={(e) => void save(e)}>
      <p className="text-fg-muted text-sm">
        Enter your head office location. Job Bank will suggest the nearest branch.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Latitude" required hint="e.g. 24.8607">
          <Input
            type="number"
            step="any"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="24.8607"
          />
        </FormField>
        <FormField label="Longitude" required hint="e.g. 67.0011">
          <Input
            type="number"
            step="any"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="67.0011"
          />
        </FormField>
      </div>
      <FormField label="Address" required>
        <Input
          placeholder="Building, street, area"
          value={addressLine}
          onChange={(e) => setAddressLine(e.target.value)}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="City code" required hint="Master data city code">
          <Input value={cityCode} onChange={(e) => setCityCode(e.target.value)} />
        </FormField>
        <FormField label="Area code">
          <Input value={areaCode} onChange={(e) => setAreaCode(e.target.value)} />
        </FormField>
      </div>
      {branches.length > 0 && (
        <FormField label="Branch" required>
          <Select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
        </FormField>
      )}
      {error && <p className="text-danger text-sm">{error}</p>}
      <Button
        type="submit"
        fullWidth
        loading={pending}
        disabled={!isReady}
        rightIcon={<ArrowRight />}
      >
        Save and continue
      </Button>
    </form>
  );
}

// ─── Documents step ─────────────────────────────────────────────────────

function DocumentsStep({
  company,
  onSaved,
}: {
  company: CompanyView;
  onSaved: (c: CompanyView) => void;
}) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [company_, setCompany_] = useState(company);

  async function upload(typeCode: string, file: File) {
    setUploading(typeCode);
    setError(null);
    try {
      const { data: presign } = await apiFetch<{
        documentId: string;
        upload: { url: string; fields: Record<string, string> };
      }>('/api/v1/companies/me/documents', {
        method: 'POST',
        body: { typeCode, fileName: file.name, contentType: file.type, sizeBytes: file.size },
      });

      const r = await fetch(presign.upload.url, { method: 'PUT', body: file });
      if (!r.ok) throw new Error('Upload to storage failed');

      const { data: saved } = await apiFetch<CompanyView>(
        `/api/v1/companies/me/documents/${presign.documentId}/confirm`,
        { method: 'POST' },
      );
      setCompany_(saved);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Upload failed. Try again.');
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-fg-muted text-sm">
        Upload the required documents. Accepted formats: PDF, JPG or PNG, up to 5 MB each.
      </p>
      {company_.requiredDocuments.length === 0 && (
        <p className="text-fg-muted text-sm">
          No documents required for your business type yet. Continue to submit.
        </p>
      )}
      {company_.requiredDocuments.map((code) => {
        const uploaded = company_.documents.find(
          (d) => d.typeCode === code && d.reviewStatus !== 'REJECTED',
        );
        return (
          <div key={code} className="border-border grid gap-2 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <span className="text-fg text-sm font-medium">{code.replace(/_/g, ' ')}</span>
              {uploaded ? (
                <Badge tone="success">Uploaded</Badge>
              ) : (
                <Badge tone="neutral">Required</Badge>
              )}
            </div>
            {uploaded && (
              <p className="text-fg-muted text-xs">
                {uploaded.fileName}
                {uploaded.reviewStatus === 'ACCEPTED' && ' · Accepted by verifier'}
              </p>
            )}
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="sr-only"
                disabled={uploading === code}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(code, file);
                }}
              />
              <span className="text-accent text-sm underline underline-offset-4">
                {uploading === code ? 'Uploading…' : uploaded ? 'Replace' : 'Upload'}
              </span>
            </label>
          </div>
        );
      })}
      {error && <p className="text-danger text-sm">{error}</p>}
      <Button
        onClick={() => onSaved(company_)}
        fullWidth
        rightIcon={<ArrowRight />}
        disabled={!!uploading}
      >
        Continue
      </Button>
    </div>
  );
}

// ─── Submit step ────────────────────────────────────────────────────────

function SubmitStep({
  company,
  onSubmitted,
  idempotencyKey,
}: {
  company: CompanyView;
  onSubmitted: (c: CompanyView) => void;
  idempotencyKey: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pill = STATUS_PILL[company.status];

  const canSubmit = company.status === 'DRAFT' || company.status === 'REJECTED';
  const canResubmit = company.status === 'INFO_REQUESTED';

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const { data: saved } = await apiFetch<CompanyView>('/api/v1/companies/me/submit', {
        method: 'POST',
        idempotencyKey,
      });
      onSubmitted(saved);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  async function resubmit() {
    setPending(true);
    setError(null);
    try {
      const { data: saved } = await apiFetch<CompanyView>('/api/v1/companies/me/resubmit', {
        method: 'POST',
        body: { note: null },
      });
      onSubmitted(saved);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="border-border bg-surface grid gap-3 rounded-xl border p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-fg font-semibold">{company.details.legalName}</h3>
          <StatusPill label={pill.label} tone={pill.variant} />
        </div>
        <dl className="grid gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-fg-muted w-32 shrink-0">NTN</dt>
            <dd className="text-fg">{company.details.ntn}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-muted w-32 shrink-0">Branch</dt>
            <dd className="text-fg">{company.branch?.name ?? 'Not set'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-muted w-32 shrink-0">Contacts</dt>
            <dd className="text-fg">{company.contacts.length}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-muted w-32 shrink-0">Documents</dt>
            <dd className="text-fg">{company.documents.length} uploaded</dd>
          </div>
        </dl>
        {company.missing.length > 0 && (
          <div className="bg-warning-soft text-warning-soft-fg grid gap-1 rounded-lg p-3 text-sm">
            <p className="font-medium">Still missing:</p>
            <ul className="grid list-disc gap-0.5 pl-4">
              {company.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {company.status === 'INFO_REQUESTED' && company.verification?.infoRequest && (
        <div className="bg-warning-soft text-warning-soft-fg grid gap-1 rounded-xl px-5 py-4 text-sm">
          <p className="font-semibold">The verifier requested more information:</p>
          <p>{company.verification.infoRequest}</p>
        </div>
      )}

      {error && <p className="text-danger text-sm">{error}</p>}

      {canSubmit && (
        <Button
          fullWidth
          loading={pending}
          disabled={company.missing.length > 0}
          leftIcon={<Send />}
          onClick={() => void submit()}
        >
          Submit for verification
        </Button>
      )}
      {canResubmit && (
        <Button fullWidth loading={pending} leftIcon={<Send />} onClick={() => void resubmit()}>
          Send back to verifier
        </Button>
      )}
      {!canSubmit && !canResubmit && (
        <div className="border-border bg-surface-muted text-fg-muted rounded-xl border p-5 text-center text-sm">
          Your company has been submitted. You will be notified by email when the verifier makes a
          decision.
        </div>
      )}
    </div>
  );
}

// ─── Main wizard ────────────────────────────────────────────────────────

export function CompanyWizard({
  initialStep,
  initialCompany,
}: {
  initialStep: string;
  initialCompany: CompanyView | null;
}) {
  const router = useRouter();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [company, setCompany] = useState<CompanyView | null>(initialCompany);
  const [currentStep, setCurrentStep] = useState<WizardStep>(() => {
    const valid = STEPS.map((s) => s.id);
    return valid.includes(initialStep as WizardStep) ? (initialStep as WizardStep) : 'details';
  });

  function goTo(step: WizardStep) {
    setCurrentStep(step);
    router.replace(`/employer/company?step=${step}`, { scroll: false });
  }

  function saved(c: CompanyView) {
    setCompany(c);
    const next = nextStep(currentStep);
    if (next) goTo(next);
  }

  const currentIdx = stepIndex(currentStep);

  return (
    <div className="grid w-full gap-6">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Register your company</h1>
        {company && (
          <p className="text-fg-muted text-sm">
            {company.details.legalName} ·{' '}
            <StatusPill
              label={STATUS_PILL[company.status].label}
              tone={STATUS_PILL[company.status].variant}
            />
          </p>
        )}
      </header>

      <nav aria-label="Registration steps" className="flex gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, idx) => (
          <button
            key={s.id}
            type="button"
            onClick={() => company && goTo(s.id)}
            disabled={!company && idx > 0}
            className={[
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
              s.id === currentStep
                ? 'bg-primary text-primary-fg'
                : 'text-fg-muted hover:bg-surface-muted',
            ].join(' ')}
          >
            {idx < currentIdx && company ? (
              <CheckCircle2 className="text-success size-3.5" aria-hidden="true" />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-3.5 shrink-0 items-center justify-center rounded-full border border-current text-center text-[10px] leading-3"
              >
                {idx + 1}
              </span>
            )}
            {s.label}
          </button>
        ))}
      </nav>

      <div className="border-border bg-surface rounded-xl border p-6">
        {currentStep === 'details' && (
          <DetailsStep company={company} onSaved={saved} idempotencyKey={idempotencyKey.current} />
        )}
        {currentStep === 'contacts' && company && (
          <ContactsStep company={company} onSaved={saved} />
        )}
        {currentStep === 'location' && company && (
          <LocationStep company={company} onSaved={saved} />
        )}
        {currentStep === 'documents' && company && (
          <DocumentsStep company={company} onSaved={saved} />
        )}
        {currentStep === 'submit' && company && (
          <SubmitStep
            company={company}
            idempotencyKey={idempotencyKey.current}
            onSubmitted={(c) => {
              setCompany(c);
            }}
          />
        )}
        {!company && currentStep !== 'details' && (
          <p className="text-fg-muted text-center text-sm">Complete company details first.</p>
        )}
      </div>

      {prevStep(currentStep) && company && (
        <button
          type="button"
          onClick={() => goTo(prevStep(currentStep)!)}
          className="text-fg-muted flex w-fit items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
      )}
    </div>
  );
}
