'use client';

import { z } from 'zod';
import {
  BONUS_BASES,
  BONUS_BASIS_LABELS,
  BONUS_FREQUENCIES,
  BONUS_FREQUENCY_LABELS,
  BONUS_TIERS,
  BONUS_TIER_LABELS,
  createJobSchema,
  EXPERIENCE_LEVELS,
  EXPERIENCE_LEVEL_LABELS,
  EXPERIENCE_LEVEL_MIN_MONTHS,
  GENDER_PREFERENCES,
  GENDER_PREFERENCE_LABELS,
  JOB_LANGUAGE_CODES,
  JOB_TYPES,
  JOB_TYPE_LABELS,
  jobRequirementsSchema,
  MEDICAL_COVERAGE_SCOPES,
  MEDICAL_COVERAGE_SCOPE_LABELS,
  MIN_SALARY_PKR,
  STANDARD_LEAVE_DAYS,
  type BonusBasis,
  type BonusFrequency,
  type BonusTier,
  type ExperienceLevel,
  type MedicalCoverageScope,
} from '@jobbank/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button, Input, Select, Textarea } from '@/components/atoms';
import { ErrorBanner, FormField, toast } from '@/components/molecules';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import {
  FormErrorSummary,
  fieldControlId,
  humanizeFieldKey,
  useFocusFieldErrors,
} from '../../../../_components/FormErrorSummary';
import {
  toFieldErrors,
  zodFieldErrors,
  type FieldErrors,
} from '../../../../_components/applicants/form';

interface Props {
  companies: { id: string; name: string }[];
  categories: { code: string; label: string }[];
  /**
   * Company to preselect (e.g. from ?companyId= on a company detail page).
   * Only honoured when it is one of `companies` — the page lists VERIFIED
   * companies in the actor's scope only, so anything else is not a valid
   * posting target and the dropdown stays unselected. The server re-checks
   * (VERIFIED + city scope) on submit.
   */
  initialCompanyId?: string;
  /** Where to land after the draft is created. Defaults to the branch-admin list. */
  successHref?: string;
}

const JOB_TYPE_OPTIONS = JOB_TYPES.map((v) => ({ value: v, label: JOB_TYPE_LABELS[v] }));
const GENDER_OPTIONS = GENDER_PREFERENCES.map((v) => ({
  value: v,
  label: GENDER_PREFERENCE_LABELS[v],
}));
const EXPERIENCE_OPTIONS = EXPERIENCE_LEVELS.map((v) => ({
  value: v,
  label: EXPERIENCE_LEVEL_LABELS[v],
}));
const LANGUAGE_LABELS: Record<(typeof JOB_LANGUAGE_CODES)[number], string> = {
  URDU: 'Urdu',
  ENGLISH: 'English',
};
const MEDICAL_SCOPE_OPTIONS = MEDICAL_COVERAGE_SCOPES.map((v) => ({
  value: v,
  label: MEDICAL_COVERAGE_SCOPE_LABELS[v],
}));
const BONUS_OPTIONS = BONUS_TIERS.map((v) => ({ value: v, label: BONUS_TIER_LABELS[v] }));
const BONUS_BASIS_OPTIONS = BONUS_BASES.map((v) => ({ value: v, label: BONUS_BASIS_LABELS[v] }));
const BONUS_FREQUENCY_OPTIONS = BONUS_FREQUENCIES.map((v) => ({
  value: v,
  label: BONUS_FREQUENCY_LABELS[v],
}));

/**
 * The exact schema POST /api/v1/jobs enforces: createJobSchema plus the
 * staff-only companyId and nested requirements (audit 2026-11-11, H-07).
 */
const staffCreateJobSchema = createJobSchema.extend({
  companyId: z.uuid(),
  requirements: jobRequirementsSchema.optional(),
});

export function StaffPostJobForm({
  companies,
  categories,
  initialCompanyId,
  successHref = '/branch-admin/jobs',
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [companyId, setCompanyId] = useState(() =>
    initialCompanyId && companies.some((c) => c.id === initialCompanyId) ? initialCompanyId : '',
  );
  const [title, setTitle] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [designationCode, setDesignationCode] = useState('');
  const [designations, setDesignations] = useState<{ value: string; label: string }[]>([]);
  const [description, setDescription] = useState('');
  const [jobType, setJobType] = useState('FULL_TIME');
  // Shift is always rotating — no dropdown in the form (2026-11-10).
  const shift = 'ROTATING';
  const [shiftHours, setShiftHours] = useState('');
  const [genderPreference, setGenderPreference] = useState('ANY');
  const [vacancies, setVacancies] = useState('1');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement | null>(null);
  const { requestErrorFocus, requestAlertFocus } = useFocusFieldErrors(errors, formRef, error);

  // Experience & languages
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('FRESHER');
  const [languageCodes, setLanguageCodes] = useState<string[]>([]);

  // Benefits & Perks
  const [fuelAllowance, setFuelAllowance] = useState(false);
  const [flexibleHours, setFlexibleHours] = useState(false);
  const [annualLeaveDays, setAnnualLeaveDays] = useState(String(STANDARD_LEAVE_DAYS.annual));
  const [sickLeaveDays, setSickLeaveDays] = useState(String(STANDARD_LEAVE_DAYS.sick));
  const [casualLeaveDays, setCasualLeaveDays] = useState(String(STANDARD_LEAVE_DAYS.casual));
  const [opdLimit, setOpdLimit] = useState('');
  const [ipdLimit, setIpdLimit] = useState('');
  const [medicalCoverageScope, setMedicalCoverageScope] = useState<MedicalCoverageScope | ''>('');
  const [bonusTier, setBonusTier] = useState<BonusTier>('NONE');
  const [bonusBasis, setBonusBasis] = useState<BonusBasis | ''>('');
  const [bonusAmountPkr, setBonusAmountPkr] = useState('');
  const [bonusFrequency, setBonusFrequency] = useState<BonusFrequency | ''>('');
  const [workFromHome, setWorkFromHome] = useState(false);
  const [providentFund, setProvidentFund] = useState(false);
  const [transportAllowance, setTransportAllowance] = useState(false);
  const [eobi, setEobi] = useState(false);
  const [lifeInsurance, setLifeInsurance] = useState(false);

  const categoryOptions = categories.map((c) => ({ value: c.code, label: c.label }));
  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name }));

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ code: string; label: string }[]>('/api/v1/master-data?type=DESIGNATION')
      .then((res) => {
        if (!cancelled) setDesignations(res.data.map((d) => ({ value: d.code, label: d.label })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSubmit() {
    startTransition(async () => {
      setError(null);
      try {
        const body = {
          companyId,
          title: title.trim(),
          categoryCode: categoryCode.trim(),
          designationCode: designationCode.trim() || undefined,
          description: description.trim(),
          jobType,
          shift,
          shiftHours: jobType === 'ROTATING' && shiftHours ? parseInt(shiftHours, 10) : undefined,
          genderPreference,
          vacancies: parseInt(vacancies, 10),
          salaryMin: salaryMin ? parseInt(salaryMin, 10) : undefined,
          salaryMax: salaryMax ? parseInt(salaryMax, 10) : undefined,
          requirements: {
            experienceLevel,
            minExperienceMonths: EXPERIENCE_LEVEL_MIN_MONTHS[experienceLevel],
            languageCodes: languageCodes.length > 0 ? languageCodes : undefined,
          },
          fuelAllowance,
          flexibleHours,
          annualLeaveDays: annualLeaveDays ? parseInt(annualLeaveDays, 10) : undefined,
          sickLeaveDays: sickLeaveDays ? parseInt(sickLeaveDays, 10) : undefined,
          casualLeaveDays: casualLeaveDays ? parseInt(casualLeaveDays, 10) : undefined,
          opdLimit: opdLimit ? parseInt(opdLimit, 10) : undefined,
          ipdLimit: ipdLimit ? parseInt(ipdLimit, 10) : undefined,
          medicalCoverageScope:
            (opdLimit || ipdLimit) && medicalCoverageScope ? medicalCoverageScope : undefined,
          bonusTier,
          bonusBasis: bonusTier !== 'NONE' && bonusBasis ? bonusBasis : undefined,
          bonusAmountPkr:
            bonusTier !== 'NONE' && bonusAmountPkr ? parseInt(bonusAmountPkr, 10) : undefined,
          bonusFrequency: bonusTier !== 'NONE' && bonusFrequency ? bonusFrequency : undefined,
          workFromHome,
          providentFund,
          transportAllowance,
          eobi,
          lifeInsurance,
        };
        // Audit 2026-11-11 (H-07): validate client-side with the same
        // schema the server enforces, so a bad salary or missing bonus
        // basis is flagged on its field instead of failing the round trip.
        const parsed = staffCreateJobSchema.safeParse(body);
        if (!parsed.success) {
          setErrors(zodFieldErrors(parsed.error));
          requestErrorFocus();
          return;
        }
        setErrors({});
        await apiFetch('/api/v1/jobs', {
          method: 'POST',
          body: parsed.data,
          // POST /jobs is idempotent and requires an Idempotency-Key —
          // the form never sent one, so every staff job post failed
          // with 400 IDEMPOTENCY_KEY_REQUIRED (found while fixing M-26).
          idempotencyKey: crypto.randomUUID(),
        });
        toast.success('Job created as draft');
        router.push(successHref);
      } catch (e) {
        if (e instanceof ApiClientError && e.issues.length > 0) {
          setErrors(toFieldErrors(e.issues));
          requestErrorFocus();
        } else {
          // A non-field server error supersedes any stale field errors.
          setErrors({});
          setError(e);
          requestAlertFocus();
        }
      }
    });
  }

  return (
    <form
      className="border-border bg-surface grid max-w-2xl gap-6 rounded-xl border p-6"
      noValidate
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      {companies.length === 0 ? (
        <p className="text-fg-muted text-sm">
          No verified companies in your branch yet. Companies must be verified before you can post
          jobs for them.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Company"
              required
              className="sm:col-span-2"
              id={fieldControlId('companyId')}
              error={errors.companyId}
            >
              <Select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                placeholder="Select a company"
                options={companyOptions}
              />
            </FormField>
            <FormField
              label="Job title"
              required
              className="sm:col-span-2"
              id={fieldControlId('title')}
              error={errors.title}
            >
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Senior Accountant"
              />
            </FormField>
            <FormField
              label="Category"
              required
              id={fieldControlId('categoryCode')}
              error={errors.categoryCode}
            >
              <Select
                value={categoryCode}
                onChange={(e) => setCategoryCode(e.target.value)}
                placeholder="Select category"
                options={categoryOptions}
              />
            </FormField>
            <FormField
              label="Designation"
              id={fieldControlId('designationCode')}
              error={errors.designationCode}
              hint="The salary must fall inside this designation's salary range, once ranges are set in master data."
            >
              {designations.length > 0 ? (
                <Select
                  value={designationCode}
                  onChange={(e) => setDesignationCode(e.target.value)}
                  placeholder="Select a designation"
                  options={designations}
                />
              ) : (
                <Input
                  value={designationCode}
                  onChange={(e) => setDesignationCode(e.target.value)}
                  placeholder="e.g. ACCOUNTANT"
                />
              )}
            </FormField>
            <FormField
              label="Job type"
              required
              id={fieldControlId('jobType')}
              error={errors.jobType}
            >
              <Select
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
                options={JOB_TYPE_OPTIONS}
              />
            </FormField>
            {jobType === 'ROTATING' && (
              <FormField
                label="How many hours for that shift?"
                required
                id={fieldControlId('shiftHours')}
                error={errors.shiftHours}
              >
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min="1"
                    max="24"
                    value={shiftHours}
                    onChange={(e) => setShiftHours(e.target.value)}
                    placeholder="e.g. 8"
                    className="w-28"
                  />
                  <span className="text-fg-muted text-sm">hours</span>
                </div>
              </FormField>
            )}
            <FormField
              label="Gender preference"
              id={fieldControlId('genderPreference')}
              error={errors.genderPreference}
            >
              <Select
                value={genderPreference}
                onChange={(e) => setGenderPreference(e.target.value)}
                options={GENDER_OPTIONS}
              />
            </FormField>
            <FormField
              label="Vacancies"
              required
              id={fieldControlId('vacancies')}
              error={errors.vacancies}
            >
              <Input
                type="number"
                min="1"
                max="9999"
                value={vacancies}
                onChange={(e) => setVacancies(e.target.value)}
              />
            </FormField>
            <FormField
              label="Salary min (PKR/mo)"
              hint="Minimum salary is PKR 41,700"
              id={fieldControlId('salaryMin')}
              error={errors.salaryMin}
            >
              <Input
                type="number"
                min={MIN_SALARY_PKR}
                value={salaryMin}
                onChange={(e) => setSalaryMin(e.target.value)}
                placeholder="e.g. 41700"
              />
            </FormField>
            <FormField
              label="Salary max (PKR/mo)"
              id={fieldControlId('salaryMax')}
              error={errors.salaryMax}
            >
              <Input
                type="number"
                min={MIN_SALARY_PKR}
                value={salaryMax}
                onChange={(e) => setSalaryMax(e.target.value)}
                placeholder="Optional"
              />
            </FormField>
            <FormField
              label="Experience level required"
              id={fieldControlId('requirements.experienceLevel')}
              error={errors['requirements.experienceLevel']}
            >
              <Select
                options={EXPERIENCE_OPTIONS}
                value={experienceLevel}
                onChange={(e) => setExperienceLevel(e.target.value as ExperienceLevel)}
              />
            </FormField>
            <FormField label="Languages required">
              <div className="flex gap-6">
                {JOB_LANGUAGE_CODES.map((code) => (
                  <label key={code} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      id={`job-language-${code}`}
                      name={`job-language-${code}`}
                      className="accent-primary size-4"
                      checked={languageCodes.includes(code)}
                      onChange={(e) =>
                        setLanguageCodes((prev) =>
                          e.target.checked ? [...prev, code] : prev.filter((c) => c !== code),
                        )
                      }
                    />
                    <span className="text-fg text-sm">{LANGUAGE_LABELS[code]}</span>
                  </label>
                ))}
              </div>
            </FormField>
            <div className="border-border rounded-xl border p-4 sm:col-span-2">
              <h3 className="text-fg mb-3 text-sm font-medium">Benefits &amp; Perks</h3>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    label="OPD limit (PKR)"
                    hint="Blank = no OPD cover"
                    id={fieldControlId('opdLimit')}
                    error={errors.opdLimit}
                  >
                    <Input
                      type="number"
                      min="0"
                      value={opdLimit}
                      onChange={(e) => setOpdLimit(e.target.value)}
                      placeholder="Optional"
                    />
                  </FormField>
                  <FormField
                    label="IPD limit (PKR)"
                    hint="Blank = no IPD cover"
                    id={fieldControlId('ipdLimit')}
                    error={errors.ipdLimit}
                  >
                    <Input
                      type="number"
                      min="0"
                      value={ipdLimit}
                      onChange={(e) => setIpdLimit(e.target.value)}
                      placeholder="Optional"
                    />
                  </FormField>
                </div>
                {(opdLimit || ipdLimit) && (
                  <FormField
                    label="Medical coverage for"
                    id={fieldControlId('medicalCoverageScope')}
                    error={errors.medicalCoverageScope}
                  >
                    <Select
                      options={MEDICAL_SCOPE_OPTIONS}
                      value={medicalCoverageScope}
                      onChange={(e) =>
                        setMedicalCoverageScope(e.target.value as MedicalCoverageScope)
                      }
                      placeholder="Individual or family?"
                    />
                  </FormField>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <FormField
                    label="Annual leave (days/year)"
                    id={fieldControlId('annualLeaveDays')}
                    error={errors.annualLeaveDays}
                  >
                    <Input
                      type="number"
                      min="0"
                      max="365"
                      value={annualLeaveDays}
                      onChange={(e) => setAnnualLeaveDays(e.target.value)}
                      placeholder="e.g. 14"
                    />
                  </FormField>
                  <FormField
                    label="Sick leave (days/year)"
                    id={fieldControlId('sickLeaveDays')}
                    error={errors.sickLeaveDays}
                  >
                    <Input
                      type="number"
                      min="0"
                      max="365"
                      value={sickLeaveDays}
                      onChange={(e) => setSickLeaveDays(e.target.value)}
                      placeholder="e.g. 10"
                    />
                  </FormField>
                  <FormField
                    label="Casual leave (days/year)"
                    id={fieldControlId('casualLeaveDays')}
                    error={errors.casualLeaveDays}
                  >
                    <Input
                      type="number"
                      min="0"
                      max="365"
                      value={casualLeaveDays}
                      onChange={(e) => setCasualLeaveDays(e.target.value)}
                      placeholder="e.g. 10"
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    label="Bonus"
                    id={fieldControlId('bonusTier')}
                    error={errors.bonusTier}
                  >
                    <Select
                      options={BONUS_OPTIONS}
                      value={bonusTier}
                      onChange={(e) => setBonusTier(e.target.value as BonusTier)}
                    />
                  </FormField>
                  {bonusTier !== 'NONE' && (
                    <FormField
                      label="Bonus calculated on"
                      required
                      id={fieldControlId('bonusBasis')}
                      error={errors.bonusBasis}
                    >
                      <Select
                        options={BONUS_BASIS_OPTIONS}
                        value={bonusBasis}
                        onChange={(e) => setBonusBasis(e.target.value as BonusBasis)}
                        placeholder="Gross or basic salary?"
                      />
                    </FormField>
                  )}
                </div>
                {bonusTier !== 'NONE' && (
                  <>
                    <FormField
                      label="Bonus frequency"
                      id={fieldControlId('bonusFrequency')}
                      error={errors.bonusFrequency}
                    >
                      <Select
                        options={BONUS_FREQUENCY_OPTIONS}
                        value={bonusFrequency}
                        onChange={(e) => setBonusFrequency(e.target.value as BonusFrequency)}
                        placeholder="How often?"
                      />
                    </FormField>
                    <FormField
                      label="Fixed bonus amount (PKR)"
                      hint="Optional — leave blank to use the tier multiple above"
                      id={fieldControlId('bonusAmountPkr')}
                      error={errors.bonusAmountPkr}
                    >
                      <Input
                        type="number"
                        min="0"
                        value={bonusAmountPkr}
                        onChange={(e) => setBonusAmountPkr(e.target.value)}
                        placeholder="Optional"
                      />
                    </FormField>
                  </>
                )}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                  {(
                    [
                      [fuelAllowance, setFuelAllowance, 'Fuel allowance'],
                      [flexibleHours, setFlexibleHours, 'Flexible hours'],
                      [workFromHome, setWorkFromHome, 'Work from home'],
                      [providentFund, setProvidentFund, 'Provident fund'],
                      [transportAllowance, setTransportAllowance, 'Transport allowance'],
                      [eobi, setEobi, 'EOBI'],
                      [lifeInsurance, setLifeInsurance, 'Life insurance'],
                    ] as [boolean, (v: boolean) => void, string][]
                  ).map(([val, setter, label]) => (
                    <label key={label} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        id={`job-benefit-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                        name={`job-benefit-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                        className="accent-primary size-4"
                        checked={val}
                        onChange={(e) => setter(e.target.checked)}
                      />
                      <span className="text-fg text-sm">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <FormField
              label="Description"
              required
              className="sm:col-span-2"
              id={fieldControlId('description')}
              error={errors.description}
            >
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the role, responsibilities and requirements…"
                rows={5}
              />
            </FormField>
          </div>
          <ErrorBanner error={error ?? undefined} operation="Create job" />
          <FormErrorSummary errors={errors} labelFor={humanizeFieldKey} />
          <div className="flex gap-3">
            <Button
              type="submit"
              loading={pending}
              disabled={
                !companyId ||
                !title ||
                !categoryCode ||
                !description ||
                !vacancies ||
                (jobType === 'ROTATING' && !shiftHours)
              }
            >
              Create job draft
            </Button>
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
