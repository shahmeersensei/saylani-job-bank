'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
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
  experienceLevelForMonths,
  GENDER_PREFERENCES,
  GENDER_PREFERENCE_LABELS,
  JOB_LANGUAGE_CODES,
  JOB_TYPES,
  JOB_TYPE_LABELS,
  MEDICAL_COVERAGE_SCOPES,
  MEDICAL_COVERAGE_SCOPE_LABELS,
  MIN_SALARY_PKR,
  SKILL_LEVELS,
  SKILL_LEVEL_LABELS,
  STANDARD_LEAVE_DAYS,
  type BonusBasis,
  type BonusFrequency,
  type BonusTier,
  type ExperienceLevel,
  type GenderPreference,
  type JobType,
  type MedicalCoverageScope,
  type SkillLevel,
} from '@jobbank/shared';
import type { JobView } from '@/domains/job';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { Button, Input, Select, Textarea } from '@/components/atoms';
import { ErrorBanner, FormField } from '@/components/molecules';
import {
  FormErrorSummary,
  fieldControlId,
  humanizeFieldKey,
  useFocusFieldErrors,
} from '../../../_components/FormErrorSummary';
import {
  toFieldErrors,
  zodFieldErrors,
  type FieldErrors,
} from '../../../_components/applicants/form';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';

// ─── Option arrays ──────────────────────────────────────────────────────

interface CityOption {
  value: string;
  label: string;
}

/** Forward-geocode result (only the pin is used here). */
interface SearchResult {
  lat: number;
  lng: number;
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
const LEVEL_OPTIONS = SKILL_LEVELS.map((v) => ({ value: v, label: SKILL_LEVEL_LABELS[v] }));

// ─── Types ──────────────────────────────────────────────────────────────

interface SkillEntry {
  skillCode: string;
  label: string;
  minLevel: SkillLevel;
  required: boolean;
}

interface Props {
  initialJob?: JobView | null;
  /** Where the employer screens live: staff consoles use their own path. */
  basePath?: string;
}

// ─── Component ──────────────────────────────────────────────────────────

export function JobWizard({ initialJob = null, basePath = '/employer' }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<unknown>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement | null>(null);
  const { requestErrorFocus, requestAlertFocus } = useFocusFieldErrors(errors, formRef, error);
  const isNew = !initialJob;

  // ── Basic info ──────────────────────────────────────────────────────
  const [title, setTitle] = useState(initialJob?.title ?? '');
  const [categoryCode, setCategoryCode] = useState(initialJob?.categoryCode ?? '');
  const [description, setDescription] = useState(initialJob?.description ?? '');
  const [jobType, setJobType] = useState<JobType>(initialJob?.jobType ?? 'FULL_TIME');
  // Shift is always rotating — no dropdown in the form (2026-11-10).
  const shift = initialJob?.shift ?? 'ROTATING';
  const [shiftHours, setShiftHours] = useState(
    initialJob?.shiftHours != null ? String(initialJob.shiftHours) : '',
  );
  const [designationCode, setDesignationCode] = useState(initialJob?.designationCode ?? '');
  const [designations, setDesignations] = useState<{ value: string; label: string }[]>([]);
  const [genderPreference, setGenderPreference] = useState<GenderPreference>(
    initialJob?.genderPreference ?? 'ANY',
  );
  const [vacancies, setVacancies] = useState(String(initialJob?.vacancies ?? 1));
  const [salaryMin, setSalaryMin] = useState(
    initialJob?.salaryMin != null ? String(initialJob.salaryMin) : '',
  );
  const [salaryMax, setSalaryMax] = useState(
    initialJob?.salaryMax != null ? String(initialJob.salaryMax) : '',
  );

  // ── Location: address + city typed by hand (2026-11-13 — no latitude /
  // longitude fields). The pin the server needs for matching and
  // publishing is located from the typed address on save (see
  // handleSubmit); an edit keeps its saved pin when the address is
  // unchanged and geocode fails.
  const saved = initialJob?.locations[0] ?? null;
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(saved?.location ?? null);
  const [addressLine, setAddressLine] = useState(saved?.addressLine ?? '');
  const [cityCode, setCityCode] = useState(saved?.cityCode ?? '');
  const [cities, setCities] = useState<CityOption[]>([]);
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([]);

  // ── Experience & Requirements ────────────────────────────────────────
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>(
    initialJob?.requirements?.experienceLevel ??
      experienceLevelForMonths(
        initialJob?.requirements?.minExperienceMonths ??
          (initialJob?.requirements?.minExperienceYears != null
            ? initialJob.requirements.minExperienceYears * 12
            : null),
      ),
  );
  const [languageCodes, setLanguageCodes] = useState<string[]>(
    (initialJob?.requirements?.languageCodes ?? []).filter((c) =>
      (JOB_LANGUAGE_CODES as readonly string[]).includes(c),
    ),
  );
  const [otherRequirements, setOtherRequirements] = useState(
    initialJob?.requirements?.otherRequirements ?? '',
  );

  // ── Skills ───────────────────────────────────────────────────────────
  const [skills, setSkills] = useState<SkillEntry[]>(
    (initialJob?.skills ?? []).map((s) => ({
      skillCode: s.skillCode,
      label: s.skillCode,
      minLevel: s.minLevel as SkillLevel,
      required: s.required ?? false,
    })),
  );
  const [pickLabel, setPickLabel] = useState('');
  const [pickLevel, setPickLevel] = useState<SkillLevel>('BEGINNER');

  function addSkill() {
    const label = pickLabel.trim();
    if (!label) return;
    const code = label.toUpperCase().replace(/\s+/g, '_');
    if (skills.some((s) => s.skillCode === code)) return;
    setSkills((prev) => [
      ...prev,
      { skillCode: code, label, minLevel: pickLevel, required: false },
    ]);
    setPickLabel('');
  }

  function handleSkillKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSkill();
    }
  }

  function updateSkillLevel(code: string, level: SkillLevel) {
    setSkills((prev) => prev.map((s) => (s.skillCode === code ? { ...s, minLevel: level } : s)));
  }

  function removeSkill(code: string) {
    setSkills((prev) => prev.filter((s) => s.skillCode !== code));
  }

  // ── Benefits ─────────────────────────────────────────────────────────
  const [fuelAllowance, setFuelAllowance] = useState(initialJob?.fuelAllowance ?? false);
  const [flexibleHours, setFlexibleHours] = useState(initialJob?.flexibleHours ?? false);
  const [annualLeaveDays, setAnnualLeaveDays] = useState(
    initialJob?.annualLeaveDays != null
      ? String(initialJob.annualLeaveDays)
      : String(STANDARD_LEAVE_DAYS.annual),
  );
  const [sickLeaveDays, setSickLeaveDays] = useState(
    initialJob?.sickLeaveDays != null
      ? String(initialJob.sickLeaveDays)
      : String(STANDARD_LEAVE_DAYS.sick),
  );
  const [casualLeaveDays, setCasualLeaveDays] = useState(
    initialJob?.casualLeaveDays != null
      ? String(initialJob.casualLeaveDays)
      : String(STANDARD_LEAVE_DAYS.casual),
  );
  const [opdLimit, setOpdLimit] = useState(
    initialJob?.opdLimit != null ? String(initialJob.opdLimit) : '',
  );
  const [ipdLimit, setIpdLimit] = useState(
    initialJob?.ipdLimit != null ? String(initialJob.ipdLimit) : '',
  );
  const [medicalCoverageScope, setMedicalCoverageScope] = useState<MedicalCoverageScope | ''>(
    initialJob?.medicalCoverageScope ?? '',
  );
  const [bonusTier, setBonusTier] = useState<BonusTier>(
    (initialJob?.bonusTier as BonusTier) ?? 'NONE',
  );
  const [bonusBasis, setBonusBasis] = useState<BonusBasis | ''>(initialJob?.bonusBasis ?? '');
  const [bonusAmountPkr, setBonusAmountPkr] = useState(
    initialJob?.bonusAmountPkr != null ? String(initialJob.bonusAmountPkr) : '',
  );
  const [bonusFrequency, setBonusFrequency] = useState<BonusFrequency | ''>(
    initialJob?.bonusFrequency ?? '',
  );
  const [workFromHome, setWorkFromHome] = useState(initialJob?.workFromHome ?? false);
  const [providentFund, setProvidentFund] = useState(initialJob?.providentFund ?? false);
  const [transportAllowance, setTransportAllowance] = useState(
    initialJob?.transportAllowance ?? false,
  );
  const [eobi, setEobi] = useState(initialJob?.eobi ?? false);
  const [lifeInsurance, setLifeInsurance] = useState(initialJob?.lifeInsurance ?? false);

  const isReady =
    title.trim().length > 0 && categoryCode.trim().length > 0 && description.trim().length > 0;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ code: string; label: string }[]>('/api/v1/master-data?type=CITY'),
      apiFetch<{ code: string; label: string }[]>('/api/v1/master-data?type=JOB_CATEGORY'),
      apiFetch<{ code: string; label: string }[]>('/api/v1/master-data?type=DESIGNATION'),
    ])
      .then(([cityRes, catRes, desRes]) => {
        if (cancelled) return;
        setCities(cityRes.data.map((c) => ({ value: c.code, label: c.label })));
        setCategories(catRes.data.map((c) => ({ value: c.code, label: c.label })));
        setDesignations(desRes.data.map((d) => ({ value: d.code, label: d.label })));
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
        // 2026-11-12: the company may fully edit its own job in any
        // editable status, so an edit sends the full body like a create —
        // the old restricted (published-job) subset is gone.
        const basicBody = {
          title: title.trim(),
          categoryCode: categoryCode.trim(),
          description: description.trim(),
          jobType,
          shift,
          shiftHours: jobType === 'ROTATING' && shiftHours ? parseInt(shiftHours, 10) : undefined,
          designationCode: designationCode.trim() || undefined,
          genderPreference,
          vacancies: parseInt(vacancies, 10),
          salaryMin: salaryMin ? parseInt(salaryMin, 10) : undefined,
          salaryMax: salaryMax ? parseInt(salaryMax, 10) : undefined,
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
        // schema the server enforces, so a bad salary, missing shift hours
        // or missing bonus basis is flagged on its field instead of a round
        // trip that fails with a one-line error at the bottom of the page.
        // An edit sends the full body, so it validates against create.
        const parsed = createJobSchema.safeParse(basicBody);
        if (!parsed.success) {
          setErrors(zodFieldErrors(parsed.error));
          requestErrorFocus();
          return;
        }
        setErrors({});

        let jobId: string;
        if (isNew) {
          const { data: created } = await apiFetch<JobView>('/api/v1/jobs/me', {
            method: 'POST',
            body: basicBody,
            // Audit 2026-11-11 (M-26): the route requires an
            // Idempotency-Key — without it a double-submit created a
            // second identical DRAFT job.
            idempotencyKey: crypto.randomUUID(),
          });
          jobId = created.id;
        } else {
          const { data: updated } = await apiFetch<JobView>(`/api/v1/jobs/me/${initialJob.id}`, {
            method: 'PATCH',
            body: basicBody,
          });
          jobId = updated.id;
        }

        // Location is sent on every save. No lat/lng fields any more
        // (2026-11-13): locate the typed address via the server geocode
        // endpoint instead. The publish guard still needs a saved pin,
        // so when the address can't be located the location is left
        // unsaved — same as before when the coordinates were blank —
        // and publishing will ask for a location.
        if (addressLine.trim().length >= 3 && cityCode) {
          const addressChanged =
            !saved || saved.addressLine !== addressLine.trim() || saved.cityCode !== cityCode;
          let usePin = pin;
          if (addressChanged || !usePin) {
            const cityLabel = cities.find((c) => c.value === cityCode)?.label ?? cityCode;
            try {
              const { data } = await apiFetch<SearchResult[]>(
                `/api/v1/geocode/search?q=${encodeURIComponent(
                  `${addressLine.trim()}, ${cityLabel}`,
                )}`,
              );
              const first = data?.[0] ?? null;
              if (first) {
                usePin = { lat: first.lat, lng: first.lng };
                setPin(usePin);
              }
            } catch {
              // Geocode down: fall back to the saved pin, if any.
            }
          }
          if (usePin) {
            await apiFetch<JobView>(`/api/v1/jobs/me/${jobId}/location`, {
              method: 'PUT',
              body: {
                location: usePin,
                addressLine: addressLine.trim(),
                cityCode,
              },
            });
          }
        }

        // Audit 2026-11-10 (C1): skills, minimum experience and
        // other-requirements were collected in this form but never saved —
        // handleSubmit sent only the basic body, so every employer job post
        // silently discarded them (and skill-based matching never saw them).
        // The subroutes already existed and were only reachable directly.
        // Requirements first (no master-data codes in what this form
        // collects), then skills.
        await apiFetch<JobView>(`/api/v1/jobs/me/${jobId}/requirements`, {
          method: 'PUT',
          body: {
            experienceLevel,
            minExperienceMonths: EXPERIENCE_LEVEL_MIN_MONTHS[experienceLevel],
            languageCodes: languageCodes.length > 0 ? languageCodes : undefined,
            otherRequirements: otherRequirements.trim() || undefined,
          },
        });
        await apiFetch<JobView>(`/api/v1/jobs/me/${jobId}/skills`, {
          method: 'PUT',
          body: {
            skills: skills.map((s) => ({
              skillCode: s.skillCode,
              minLevel: s.minLevel,
              required: s.required ?? false,
            })),
          },
        });

        if (isNew) router.push(`${basePath}/jobs/${jobId}`);
        else router.refresh();
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

  const locationReady = addressLine.trim().length >= 3 && cityCode;

  return (
    <form
      className="grid w-full gap-8"
      noValidate
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <header>
        <h1 className="text-fg text-2xl font-semibold">{isNew ? 'Post a new job' : 'Edit job'}</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Fill in the details below. All sections except job title, category and description are
          optional.
        </p>
      </header>

      <div className="grid gap-6">
        {/* ─── Basic Info ─────────────────────────────────────────────── */}
        <Section title="Basic Information">
          <FormField label="Job title" required id={fieldControlId('title')} error={errors.title}>
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
            {categories.length > 0 ? (
              <Select
                value={categoryCode}
                onChange={(e) => setCategoryCode(e.target.value)}
                options={categories}
                placeholder="Select a job category"
              />
            ) : (
              <Input
                value={categoryCode}
                onChange={(e) => setCategoryCode(e.target.value)}
                placeholder="e.g. ACCOUNTING"
              />
            )}
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
                options={designations}
                placeholder="Select a designation"
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
            label="Job description"
            required
            id={fieldControlId('description')}
            error={errors.description}
          >
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="Describe the role, responsibilities, and what you are looking for…"
            />
          </FormField>

          <FormField
            label="Job type"
            required
            id={fieldControlId('jobType')}
            error={errors.jobType}
          >
            <Select
              options={JOB_TYPE_OPTIONS}
              value={jobType}
              onChange={(e) => setJobType(e.target.value as JobType)}
            />
          </FormField>

          {jobType === 'ROTATING' && (
            <FormField
              label="How many hours for that shift?"
              required
              hint="Hours per shift / day"
              id={fieldControlId('shiftHours')}
              error={errors.shiftHours}
            >
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={shiftHours}
                  onChange={(e) => setShiftHours(e.target.value)}
                  placeholder="e.g. 8"
                  className="w-28"
                />
                <span className="text-fg-muted text-sm">hours</span>
              </div>
            </FormField>
          )}

          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="Gender preference"
              id={fieldControlId('genderPreference')}
              error={errors.genderPreference}
            >
              <Select
                options={GENDER_OPTIONS}
                value={genderPreference}
                onChange={(e) => setGenderPreference(e.target.value as GenderPreference)}
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
                min={1}
                value={vacancies}
                onChange={(e) => setVacancies(e.target.value)}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="Min salary (PKR/month)"
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
              label="Max salary (PKR/month)"
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
          </div>
        </Section>

        {/* ─── Experience & Requirements ───────────────────────────────── */}
        <Section title="Experience & Requirements">
          <FormField label="Experience level required">
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

          <FormField
            label="Other requirements"
            hint="Any additional requirements, certifications, or notes"
          >
            <Textarea
              rows={3}
              value={otherRequirements}
              onChange={(e) => setOtherRequirements(e.target.value)}
              placeholder="e.g. Must hold a valid driving licence. Experience with SAP preferred."
            />
          </FormField>
        </Section>

        {/* ─── Skills ─────────────────────────────────────────────────── */}
        <Section
          title="Skills Required"
          hint="Add the skills candidates should have for this role."
        >
          {/* Add skill row */}
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Skill" className="min-w-[180px] flex-1">
              <Input
                value={pickLabel}
                onChange={(e) => setPickLabel(e.target.value)}
                onKeyDown={handleSkillKeyDown}
                placeholder="e.g. MS Excel, AutoCAD, React…"
              />
            </FormField>

            <FormField label="Proficiency level" className="min-w-[160px]">
              <Select
                value={pickLevel}
                onChange={(e) => setPickLevel(e.target.value as SkillLevel)}
                options={LEVEL_OPTIONS}
              />
            </FormField>

            <Button
              type="button"
              variant="secondary"
              onClick={addSkill}
              disabled={!pickLabel.trim()}
              leftIcon={<Plus className="size-4" />}
            >
              Add skill
            </Button>
          </div>

          {/* Skill chips */}
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {skills.map((s) => (
                <div
                  key={s.skillCode}
                  className="bg-surface border-border flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
                >
                  <span className="text-fg font-medium">{s.label}</span>
                  <span className="text-fg-muted">·</span>
                  <select
                    id={`job-skill-level-${s.skillCode}`}
                    name={`job-skill-level-${s.skillCode}`}
                    aria-label={`Minimum level for ${s.label}`}
                    value={s.minLevel}
                    onChange={(e) => updateSkillLevel(s.skillCode, e.target.value as SkillLevel)}
                    className="text-fg-muted bg-transparent text-xs focus:outline-none disabled:cursor-not-allowed"
                  >
                    {SKILL_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {SKILL_LEVEL_LABELS[l]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeSkill(s.skillCode)}
                    className="text-fg-subtle hover:text-danger ml-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`Remove ${s.label}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ─── Benefits & Perks ─────────────────────────────────────────── */}
        <Section title="Benefits & Perks">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="OPD limit (PKR)"
              hint="Leave blank for no OPD cover"
              id={fieldControlId('opdLimit')}
              error={errors.opdLimit}
            >
              <Input
                type="number"
                min={0}
                value={opdLimit}
                onChange={(e) => setOpdLimit(e.target.value)}
                placeholder="Optional"
              />
            </FormField>
            <FormField
              label="IPD limit (PKR)"
              hint="Leave blank for no IPD cover"
              id={fieldControlId('ipdLimit')}
              error={errors.ipdLimit}
            >
              <Input
                type="number"
                min={0}
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
                onChange={(e) => setMedicalCoverageScope(e.target.value as MedicalCoverageScope)}
                placeholder="Individual or family?"
              />
            </FormField>
          )}

          <div className="grid grid-cols-3 gap-4">
            <FormField
              label="Annual leave (days / year)"
              id={fieldControlId('annualLeaveDays')}
              error={errors.annualLeaveDays}
            >
              <Input
                type="number"
                min={0}
                max={365}
                value={annualLeaveDays}
                onChange={(e) => setAnnualLeaveDays(e.target.value)}
                placeholder="e.g. 14"
              />
            </FormField>
            <FormField
              label="Sick leave (days / year)"
              id={fieldControlId('sickLeaveDays')}
              error={errors.sickLeaveDays}
            >
              <Input
                type="number"
                min={0}
                max={365}
                value={sickLeaveDays}
                onChange={(e) => setSickLeaveDays(e.target.value)}
                placeholder="e.g. 10"
              />
            </FormField>
            <FormField
              label="Casual leave (days / year)"
              id={fieldControlId('casualLeaveDays')}
              error={errors.casualLeaveDays}
            >
              <Input
                type="number"
                min={0}
                max={365}
                value={casualLeaveDays}
                onChange={(e) => setCasualLeaveDays(e.target.value)}
                placeholder="e.g. 10"
              />
            </FormField>
          </div>

          <FormField
            label="Performance bonus"
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
            <>
              <div className="grid grid-cols-2 gap-4">
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
              </div>
              <FormField
                label="Fixed bonus amount (PKR)"
                hint="Optional — leave blank to use the tier multiple above"
                id={fieldControlId('bonusAmountPkr')}
                error={errors.bonusAmountPkr}
              >
                <Input
                  type="number"
                  min={0}
                  value={bonusAmountPkr}
                  onChange={(e) => setBonusAmountPkr(e.target.value)}
                  placeholder="Optional"
                />
              </FormField>
            </>
          )}

          <div className="grid grid-cols-2 gap-x-8 gap-y-3 pt-1">
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
              <label key={label} className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  id={`job-benefit-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  name={`job-benefit-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  className="accent-primary size-4 rounded"
                  checked={val}
                  onChange={(e) => setter(e.target.checked)}
                />
                <span className="text-fg text-sm">{label}</span>
              </label>
            ))}
          </div>
        </Section>

        <div className="grid gap-4 border-t pt-6">
          <div>
            <h2 className="text-fg text-lg font-semibold">Work location</h2>
            <p className="text-fg-muted text-sm">
              Type the job site&apos;s address and pick the city — we&apos;ll locate it for you when
              you save.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Address" className="sm:col-span-2">
              <Input
                value={addressLine}
                onChange={(e) => {
                  setAddressLine(e.target.value);
                }}
                placeholder="House, street and block"
              />
            </FormField>

            <FormField label="City">
              <Select
                placeholder={cities.length ? 'Choose the city' : 'Loading cities…'}
                value={cityCode}
                onChange={(e) => setCityCode(e.target.value)}
                options={cities}
              />
            </FormField>
          </div>

          {!locationReady && (
            <p className="text-fg-muted text-sm">
              The location is saved once you fill the address (3+ characters) and pick a city — a
              saved location is required before publishing.
            </p>
          )}
        </div>

        <ErrorBanner error={error ?? undefined} operation="Save job" />
        <FormErrorSummary errors={errors} labelFor={humanizeFieldKey} />

        <div className="flex justify-end gap-3 pb-4">
          <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={!isReady || pending}>
            {isNew ? 'Create draft' : 'Save changes'}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ─── Section wrapper ────────────────────────────────────────────────────

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border rounded-xl border p-5">
      <div className="mb-4">
        <h2 className="text-fg font-semibold">{title}</h2>
        {hint && <p className="text-fg-muted mt-0.5 text-sm">{hint}</p>}
      </div>
      <div className="grid gap-4">{children}</div>
    </div>
  );
}
