'use client';

import {
  COMPANY_SIZE_BANDS,
  COMPANY_SIZE_LABELS,
  LEGAL_STRUCTURES,
  LEGAL_STRUCTURE_LABELS,
  staffOnboardCompanySchema,
} from '@jobbank/shared';
import { Building2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Button, Input, Select, Textarea } from '@/components/atoms';
import type { SelectOption } from '@/components/atoms';
import { DateTimePicker, FormField, Modal } from '@/components/molecules';
import type { CompanyOnboarding, CompanyView } from '@/domains/company';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { errorMessage, toFieldErrors, zodFieldErrors, type FieldErrors } from '../applicants/form';
import {
  FormErrorSummary,
  fieldControlId,
  humanizeFieldKey,
  useFocusFieldErrors,
} from '../FormErrorSummary';

interface MasterDataOption {
  id: string;
  code: string;
  label: string;
  parentId: string | null;
}

type OnboardedCompany = CompanyView & { onboarding: CompanyOnboarding };

const todayIso = () => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
};

interface Props {
  branches: SelectOption[];
  placement?: 'default' | 'sidebar';
}

const STRUCTURE_OPTIONS = LEGAL_STRUCTURES.map((v) => ({
  value: v,
  label: LEGAL_STRUCTURE_LABELS[v],
}));
const SIZE_OPTIONS = COMPANY_SIZE_BANDS.map((v) => ({ value: v, label: COMPANY_SIZE_LABELS[v] }));

/** Visible labels for error keys, used by the error summary. */
const COMPANY_FIELD_LABELS: Record<string, string> = {
  branchId: 'Branch',
  legalName: 'Legal name',
  tradeName: 'Trading name',
  legalStructure: 'Legal structure',
  ntn: 'NTN',
  registrationNo: 'Registration No.',
  industryCode: 'Industry',
  sizeBand: 'Company size',
  website: 'Website',
  description: 'Description',
  contactName: 'Contact person',
  contactDesignation: 'Designation',
  contactPhone: 'Phone',
  contactEmail: 'Email',
  visitDate: 'Visit date',
  headOfficeAddress: 'Head-office address',
  otherSites: 'Other sites',
  workforceRoles: 'Roles to hire for',
  workforceType: 'Type of work',
  workforceShifts: 'Shifts / timings',
  workforceOpenings: 'Number of openings',
  yearsInBusiness: 'Years in business',
  certifications: 'Certifications',
  previousHiring: 'Previous hiring experience',
  additionalNotes: 'Additional details / assessment notes',
};

function companyFieldLabel(key: string): string {
  return COMPANY_FIELD_LABELS[key] ?? humanizeFieldKey(key);
}

/**
 * The five registration steps, shown one at a time (2026-11-13, user).
 * Step 5 folds in the workforce-needs and business-background fields that
 * used to be their own sections: they are optional detail, collected here
 * under "Additional information" with the assessment notes.
 */
const STEPS = [
  {
    title: 'Company details',
    description: 'The registered company, its industry and size.',
    fields: [
      'branchId',
      'legalName',
      'tradeName',
      'legalStructure',
      'ntn',
      'registrationNo',
      'industryCode',
      'sizeBand',
      'website',
      'description',
    ],
  },
  {
    title: 'Contact person',
    description: 'The person you met at the company.',
    fields: ['contactName', 'contactDesignation', 'contactPhone', 'contactEmail'],
  },
  {
    title: 'Outreach record',
    description: 'When you visited the company.',
    fields: ['visitDate'],
  },
  {
    title: 'Address & locations',
    description: 'Head office and any other sites.',
    fields: ['headOfficeAddress', 'otherSites'],
  },
  {
    title: 'Additional information',
    description: 'Workforce needs, business background and assessment notes. All optional.',
    fields: [
      'workforceRoles',
      'workforceType',
      'workforceShifts',
      'workforceOpenings',
      'yearsInBusiness',
      'certifications',
      'previousHiring',
      'additionalNotes',
    ],
  },
] as const;

/** Which step a field belongs to, for jumping to a server-side field error. */
function stepForField(key: string): number {
  const idx = STEPS.findIndex((s) => (s.fields as readonly string[]).includes(key));
  return idx === -1 ? 0 : idx;
}

export function RegisterCompanyDialog({ branches, placement = 'default' }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const { requestErrorFocus, requestAlertFocus } = useFocusFieldErrors(errors, formRef, alert);
  const [company, setCompany] = useState<OnboardedCompany | null>(null);
  const [industries, setIndustries] = useState<MasterDataOption[]>([]);
  const [step, setStep] = useState(0);
  // Highest step reached: the stepper only lets the user jump back to a
  // step they have already passed through (later steps need Next validation).
  const [maxStep, setMaxStep] = useState(0);
  const goToStep = (next: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, next));
    setStep(clamped);
    setMaxStep((current) => Math.max(current, clamped));
  };
  const [form, setForm] = useState({
    branchId: branches.length === 1 ? branches[0]!.value : '',
    legalName: '',
    tradeName: '',
    legalStructure: '',
    ntn: '',
    registrationNo: '',
    industryCode: '',
    sizeBand: '',
    website: '',
    description: '',
    contactName: '',
    contactDesignation: '',
    contactPhone: '',
    contactEmail: '',
    visitDate: todayIso(),
    headOfficeAddress: '',
    otherSites: '',
    workforceRoles: '',
    workforceType: '',
    workforceShifts: '',
    workforceOpenings: '',
    yearsInBusiness: '',
    previousHiring: '',
    certifications: '',
    additionalNotes: '',
  });

  const updateForm = (changes: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...changes }));

  /** Validate only the current step's fields, from the full schema. */
  const stepErrors = (): FieldErrors => {
    const parsed = staffOnboardCompanySchema.safeParse(form);
    if (parsed.success) return {};
    const all = zodFieldErrors(parsed.error);
    const wanted = new Set(STEPS[step]!.fields as readonly string[]);
    return Object.fromEntries(Object.entries(all).filter(([key]) => wanted.has(key)));
  };

  const goNext = () => {
    const current = stepErrors();
    if (Object.keys(current).length > 0) {
      setErrors(current);
      requestErrorFocus();
      return;
    }
    setErrors({});
    goToStep(step + 1);
  };

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    setCompany(null);
  }, [pathname]);

  const companyId = company?.id;
  useEffect(() => {
    if (companyId === undefined) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [companyId]);

  useEffect(() => {
    if (!open) return;
    if (industries.length > 0) return;
    let active = true;
    setLoadingOptions(true);
    setAlert(null);
    apiFetch<MasterDataOption[]>('/api/v1/master-data?type=INDUSTRY')
      .then(({ data }) => {
        if (active) setIndustries(data ?? []);
      })
      .catch((error: unknown) => {
        if (active) setAlert(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoadingOptions(false);
      });
    return () => {
      active = false;
    };
  }, [open, industries.length]);

  const setDialogOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      setCompany(null);
      setErrors({});
      setAlert(null);
      setStep(0);
      setMaxStep(0);
      setForm({
        branchId: branches.length === 1 ? branches[0]!.value : '',
        legalName: '',
        tradeName: '',
        legalStructure: '',
        ntn: '',
        registrationNo: '',
        industryCode: '',
        sizeBand: '',
        website: '',
        description: '',
        contactName: '',
        contactDesignation: '',
        contactPhone: '',
        contactEmail: '',
        visitDate: todayIso(),
        headOfficeAddress: '',
        otherSites: '',
        workforceRoles: '',
        workforceType: '',
        workforceShifts: '',
        workforceOpenings: '',
        yearsInBusiness: '',
        previousHiring: '',
        certifications: '',
        additionalNotes: '',
      });
    }
  };

  const saveCompany = async () => {
    setAlert(null);
    const parsed = staffOnboardCompanySchema.safeParse(form);
    if (!parsed.success) {
      const all = zodFieldErrors(parsed.error);
      // Jump to the step holding the first invalid field and show only
      // that step's errors — the rest are hidden until the user gets there.
      const firstKey = Object.keys(all)[0] ?? '';
      const target = stepForField(firstKey);
      const wanted = new Set(STEPS[target]!.fields as readonly string[]);
      goToStep(target);
      setErrors(Object.fromEntries(Object.entries(all).filter(([key]) => wanted.has(key))));
      requestErrorFocus();
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const { data } = await apiFetch<OnboardedCompany>('/api/v1/companies/onboard', {
        method: 'POST',
        body: parsed.data,
        // L10: the onboard route requires an Idempotency-Key — one fresh key
        // per save, so a double-click replays instead of creating a second
        // DRAFT (the F4 resumption is the backstop, not the guard).
        idempotencyKey: crypto.randomUUID(),
      });
      setCompany(data);
      setOpen(false);
      router.replace(pathname);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.issues.length > 0) {
        const fieldErrors = toFieldErrors(error.issues);
        // Jump to the step holding the first rejected field, so the error
        // is visible instead of sitting on a hidden step.
        goToStep(stepForField(Object.keys(fieldErrors)[0] ?? ''));
        setErrors(fieldErrors);
        requestErrorFocus();
      } else if (
        error instanceof ApiClientError &&
        (error.details as { reason?: unknown } | null)?.reason === 'NTN_TAKEN'
      ) {
        // A duplicate NTN is a field problem, not a page-level one: show it
        // on the NTN field instead of the generic alert.
        goToStep(0);
        setErrors({ ntn: error.message, ...toFieldErrors(error.issues) });
        requestErrorFocus();
      } else {
        // A non-field server error supersedes any stale field errors.
        setErrors({});
        setAlert(errorMessage(error));
        requestAlertFocus();
      }
    } finally {
      setLoading(false);
    }
  };

  const industryOptions = industries.map((i) => ({ value: i.code, label: i.label }));
  const branchOptions = branches;

  return (
    <>
      <Modal
        title="Register company"
        description="Register a company you visited and onboarded. The Branch Admin reviews it after you save it."
        open={open}
        onOpenChange={setDialogOpen}
        size="lg"
        trigger={
          <Button fullWidth={placement === 'sidebar'} leftIcon={<Building2 aria-hidden="true" />}>
            Register Company
          </Button>
        }
      >
        <form
          className="grid gap-5"
          onSubmit={(event) => event.preventDefault()}
          noValidate
          ref={formRef}
        >
          {alert && (
            <p
              role="alert"
              className="bg-danger-soft text-danger-soft-fg rounded-lg px-4 py-3 text-sm"
            >
              {alert}
            </p>
          )}
          {loadingOptions && <p className="text-fg-muted text-sm">Loading options…</p>}
          <nav aria-label="Registration steps" className="flex gap-1 overflow-x-auto pb-1">
            {STEPS.map((s, idx) => {
              const isCurrent = idx === step;
              const isComplete = idx < step;
              const reachable = idx <= maxStep;
              return (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => reachable && goToStep(idx)}
                  disabled={!reachable}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={[
                    'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    'focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-50',
                    isCurrent
                      ? 'bg-primary text-primary-fg'
                      : 'text-fg-muted hover:bg-surface-muted',
                  ].join(' ')}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-[11px] font-semibold"
                  >
                    {isComplete ? '✓' : idx + 1}
                  </span>
                  <span className="font-medium">{s.title}</span>
                </button>
              );
            })}
          </nav>
          <div
            role="progressbar"
            aria-valuenow={step + 1}
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]!.title}`}
            className="bg-surface-muted h-2 overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-300"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
          <div className="grid gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-fg text-lg font-semibold">{STEPS[step]!.title}</h2>
              <span className="text-fg-muted text-xs">
                Step {step + 1} of {STEPS.length}
              </span>
            </div>
            <p className="text-fg-muted text-sm">{STEPS[step]!.description}</p>
          </div>

          {step === 0 && (
            <section className="grid gap-3">
              {branches.length > 1 && (
                <FormField
                  label="Branch"
                  required
                  error={errors.branchId}
                  id={fieldControlId('branchId')}
                >
                  <Select
                    value={form.branchId}
                    onChange={(event) => updateForm({ branchId: event.target.value })}
                    placeholder="Choose a branch"
                    options={branchOptions}
                  />
                </FormField>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label="Legal name"
                  required
                  error={errors.legalName}
                  id={fieldControlId('legalName')}
                >
                  <Input
                    value={form.legalName}
                    onChange={(e) => updateForm({ legalName: e.target.value })}
                    placeholder="Registered company name"
                  />
                </FormField>
                <FormField
                  label="Trading name"
                  error={errors.tradeName}
                  id={fieldControlId('tradeName')}
                >
                  <Input
                    value={form.tradeName}
                    onChange={(e) => updateForm({ tradeName: e.target.value })}
                    placeholder="If different from legal name"
                  />
                </FormField>
                <FormField
                  label="Legal structure"
                  required
                  error={errors.legalStructure}
                  id={fieldControlId('legalStructure')}
                >
                  <Select
                    value={form.legalStructure}
                    onChange={(e) => updateForm({ legalStructure: e.target.value })}
                    placeholder="Choose type"
                    options={STRUCTURE_OPTIONS}
                  />
                </FormField>
                <FormField label="NTN" error={errors.ntn} id={fieldControlId('ntn')}>
                  <Input
                    value={form.ntn}
                    onChange={(e) => updateForm({ ntn: e.target.value })}
                    placeholder="e.g. 1234567-8 — leave blank if unknown"
                  />
                </FormField>
                <FormField
                  label="Registration No."
                  error={errors.registrationNo}
                  id={fieldControlId('registrationNo')}
                >
                  <Input
                    value={form.registrationNo}
                    onChange={(e) => updateForm({ registrationNo: e.target.value })}
                    placeholder="Optional"
                  />
                </FormField>
                <FormField
                  label="Industry"
                  required
                  error={errors.industryCode}
                  id={fieldControlId('industryCode')}
                >
                  <Select
                    value={form.industryCode}
                    onChange={(e) => updateForm({ industryCode: e.target.value })}
                    placeholder="Select industry"
                    options={industryOptions}
                  />
                </FormField>
                <FormField
                  label="Company size"
                  required
                  error={errors.sizeBand}
                  id={fieldControlId('sizeBand')}
                >
                  <Select
                    value={form.sizeBand}
                    onChange={(e) => updateForm({ sizeBand: e.target.value })}
                    placeholder="Select size"
                    options={SIZE_OPTIONS}
                  />
                </FormField>
                <FormField label="Website" error={errors.website} id={fieldControlId('website')}>
                  <Input
                    value={form.website}
                    onChange={(e) => updateForm({ website: e.target.value })}
                    placeholder="https://example.com"
                  />
                </FormField>
                <FormField
                  label="Description"
                  error={errors.description}
                  id={fieldControlId('description')}
                  className="sm:col-span-2"
                >
                  <Textarea
                    value={form.description}
                    onChange={(e) => updateForm({ description: e.target.value })}
                    placeholder="Brief description of the company (optional)"
                    rows={3}
                  />
                </FormField>
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label="Contact person"
                  required
                  error={errors.contactName}
                  id={fieldControlId('contactName')}
                >
                  <Input
                    autoComplete="name"
                    value={form.contactName}
                    onChange={(e) => updateForm({ contactName: e.target.value })}
                    placeholder="Full name of the person you met"
                  />
                </FormField>
                <FormField
                  label="Designation"
                  error={errors.contactDesignation}
                  id={fieldControlId('contactDesignation')}
                >
                  <Input
                    value={form.contactDesignation}
                    onChange={(e) => updateForm({ contactDesignation: e.target.value })}
                    placeholder="e.g. HR Manager"
                  />
                </FormField>
                <FormField
                  label="Phone"
                  required
                  error={errors.contactPhone}
                  id={fieldControlId('contactPhone')}
                >
                  <Input
                    type="tel"
                    autoComplete="tel"
                    value={form.contactPhone}
                    onChange={(e) => updateForm({ contactPhone: e.target.value })}
                    placeholder="0300 1234567 or 021 34567890"
                  />
                </FormField>
                <FormField
                  label="Email"
                  error={errors.contactEmail}
                  id={fieldControlId('contactEmail')}
                >
                  <Input
                    type="email"
                    autoComplete="email"
                    value={form.contactEmail}
                    onChange={(e) => updateForm({ contactEmail: e.target.value })}
                    placeholder="Optional"
                  />
                </FormField>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label="Visit date"
                  required
                  error={errors.visitDate}
                  id={fieldControlId('visitDate')}
                >
                  <DateTimePicker
                    mode="date"
                    max={todayIso()}
                    value={form.visitDate}
                    onChange={(iso) => updateForm({ visitDate: iso })}
                  />
                </FormField>
              </div>
              <p className="text-fg-muted text-sm">
                Your name is recorded automatically as the person who onboarded this company.
              </p>
            </section>
          )}

          {step === 3 && (
            <section className="grid gap-3">
              <FormField
                label="Head-office address"
                error={errors.headOfficeAddress}
                id={fieldControlId('headOfficeAddress')}
              >
                <Input
                  autoComplete="street-address"
                  value={form.headOfficeAddress}
                  onChange={(e) => updateForm({ headOfficeAddress: e.target.value })}
                  placeholder="Plot / building, street, area, city"
                />
              </FormField>
              <FormField
                label="Other sites"
                error={errors.otherSites}
                id={fieldControlId('otherSites')}
              >
                <Textarea
                  value={form.otherSites}
                  onChange={(e) => updateForm({ otherSites: e.target.value })}
                  placeholder="Other factories, shops or offices, if any"
                  rows={2}
                />
              </FormField>
            </section>
          )}

          {step === 4 && (
            <section className="grid gap-3">
              <h3 className="text-fg text-sm font-semibold tracking-wide uppercase">
                Workforce needs
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label="Roles to hire for"
                  error={errors.workforceRoles}
                  id={fieldControlId('workforceRoles')}
                >
                  <Input
                    value={form.workforceRoles}
                    onChange={(e) => updateForm({ workforceRoles: e.target.value })}
                    placeholder="e.g. Machine operators, helpers"
                  />
                </FormField>
                <FormField
                  label="Type of work"
                  error={errors.workforceType}
                  id={fieldControlId('workforceType')}
                >
                  <Input
                    value={form.workforceType}
                    onChange={(e) => updateForm({ workforceType: e.target.value })}
                    placeholder="e.g. Full-time, shift-based"
                  />
                </FormField>
                <FormField
                  label="Shifts / timings"
                  error={errors.workforceShifts}
                  id={fieldControlId('workforceShifts')}
                >
                  <Input
                    value={form.workforceShifts}
                    onChange={(e) => updateForm({ workforceShifts: e.target.value })}
                    placeholder="e.g. Day shift, 9am–6pm"
                  />
                </FormField>
                <FormField
                  label="Number of openings"
                  error={errors.workforceOpenings}
                  id={fieldControlId('workforceOpenings')}
                >
                  <Input
                    value={form.workforceOpenings}
                    onChange={(e) => updateForm({ workforceOpenings: e.target.value })}
                    placeholder="If known"
                  />
                </FormField>
              </div>
              <h3 className="text-fg text-sm font-semibold tracking-wide uppercase">
                Business background
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label="Years in business"
                  error={errors.yearsInBusiness}
                  id={fieldControlId('yearsInBusiness')}
                >
                  <Input
                    value={form.yearsInBusiness}
                    onChange={(e) => updateForm({ yearsInBusiness: e.target.value })}
                    placeholder="e.g. 5 years"
                  />
                </FormField>
                <FormField
                  label="Certifications"
                  error={errors.certifications}
                  id={fieldControlId('certifications')}
                >
                  <Input
                    value={form.certifications}
                    onChange={(e) => updateForm({ certifications: e.target.value })}
                    placeholder="If any"
                  />
                </FormField>
                <FormField
                  label="Previous hiring experience"
                  error={errors.previousHiring}
                  id={fieldControlId('previousHiring')}
                  className="sm:col-span-2"
                >
                  <Textarea
                    value={form.previousHiring}
                    onChange={(e) => updateForm({ previousHiring: e.target.value })}
                    placeholder="How the company hired before, if known"
                    rows={2}
                  />
                </FormField>
              </div>
              <h3 className="text-fg text-sm font-semibold tracking-wide uppercase">
                Additional notes
              </h3>
              <FormField
                label="Additional details / assessment notes"
                error={errors.additionalNotes}
                id={fieldControlId('additionalNotes')}
              >
                <Textarea
                  value={form.additionalNotes}
                  onChange={(e) => updateForm({ additionalNotes: e.target.value })}
                  placeholder="Anything else needed to assess the company"
                  rows={3}
                />
              </FormField>
            </section>
          )}

          {branches.length === 0 && (
            <p role="alert" className="text-danger text-sm">
              No branch is available for this account.
            </p>
          )}
          <FormErrorSummary errors={errors} labelFor={companyFieldLabel} />
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => goToStep(step - 1)}
              disabled={step === 0}
            >
              Back
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              {step < STEPS.length - 1 ? (
                <Button type="button" onClick={goNext} disabled={loadingOptions}>
                  Next
                </Button>
              ) : (
                <Button
                  type="button"
                  loading={loading}
                  disabled={branches.length === 0 || loadingOptions}
                  onClick={() => void saveCompany()}
                >
                  Save company
                </Button>
              )}
            </div>
          </div>
        </form>
      </Modal>

      {company &&
        createPortal(
          <section className="registration-review-screen pointer-events-auto fixed inset-0 z-[100] overflow-y-auto bg-[#021b15] p-4 text-[#edf5f2] sm:p-8">
            <div className="mx-auto max-w-5xl">
              <div className="rounded-[28px] border border-[#1b352f] bg-[#071f1a]/95 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.25)] sm:p-7">
                <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#24453e] pb-4">
                  <div className="space-y-1">
                    <h1 className="text-3xl font-black tracking-tight text-[#f2f8f5] sm:text-4xl">
                      Company registered
                    </h1>
                    <p className="max-w-3xl text-sm text-[#a5beb5] sm:text-base">
                      Saved as a draft. The Branch Admin will review it — printing and signing the
                      form now happen on the company page, not here.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCompany(null);
                        router.refresh();
                      }}
                    >
                      Done
                    </Button>
                  </div>
                </header>
                {alert && (
                  <p
                    role="alert"
                    className="bg-danger-soft text-danger-soft-fg mt-4 rounded-lg px-4 py-3 text-sm"
                  >
                    {alert}
                  </p>
                )}
                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl border border-[#2d473f] bg-[#0b201c] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-2xl font-bold text-[#f6faf8]">
                          {company.details.legalName}
                        </h2>
                        <p className="mt-1 text-sm text-[#a5beb5]">
                          {company.status.charAt(0) + company.status.slice(1).toLowerCase()} ·
                          Company reference {company.id}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>,
          document.body,
        )}
    </>
  );
}
