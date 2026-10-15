'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  BONUS_TIERS,
  BONUS_TIER_LABELS,
  GENDER_PREFERENCES,
  GENDER_PREFERENCE_LABELS,
  JOB_TYPES,
  JOB_TYPE_LABELS,
  MEDICAL_COVERAGE_TYPES,
  MEDICAL_COVERAGE_LABELS,
  SHIFT_TYPES,
  SHIFT_TYPE_LABELS,
  SKILL_LEVELS,
  SKILL_LEVEL_LABELS,
  type BonusTier,
  type GenderPreference,
  type JobType,
  type MedicalCoverageType,
  type ShiftType,
  type SkillLevel,
} from '@jobbank/shared';
import type { JobView } from '@/domains/job';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { Button, Input, Select, Spinner, Textarea } from '@/components/atoms';
import { FormField } from '@/components/molecules';
import { MapPinPicker, type LatLng } from '@/components/organisms';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';

// ─── Option arrays ──────────────────────────────────────────────────────

interface CityOption {
  value: string;
  label: string;
}

interface ReverseResult {
  addressLine: string;
  cityCode: string | null;
  cityLabel: string | null;
}

const JOB_TYPE_OPTIONS = JOB_TYPES.map((v) => ({ value: v, label: JOB_TYPE_LABELS[v] }));
const SHIFT_OPTIONS = SHIFT_TYPES.map((v) => ({ value: v, label: SHIFT_TYPE_LABELS[v] }));
const GENDER_OPTIONS = GENDER_PREFERENCES.map((v) => ({
  value: v,
  label: GENDER_PREFERENCE_LABELS[v],
}));
const MEDICAL_OPTIONS = MEDICAL_COVERAGE_TYPES.map((v) => ({
  value: v,
  label: MEDICAL_COVERAGE_LABELS[v],
}));
const BONUS_OPTIONS = BONUS_TIERS.map((v) => ({ value: v, label: BONUS_TIER_LABELS[v] }));
const LEVEL_OPTIONS = SKILL_LEVELS.map((v) => ({ value: v, label: SKILL_LEVEL_LABELS[v] }));

function friendlyError(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  return 'Something went wrong. Please try again.';
}

// ─── Types ──────────────────────────────────────────────────────────────

interface SkillEntry {
  skillCode: string;
  label: string;
  minLevel: SkillLevel;
  required: boolean;
}

interface Props {
  initialJob?: JobView | null;
}

// ─── Component ──────────────────────────────────────────────────────────

export function JobWizard({ initialJob = null }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isNew = !initialJob;

  // ── Basic info ──────────────────────────────────────────────────────
  const [title, setTitle] = useState(initialJob?.title ?? '');
  const [categoryCode, setCategoryCode] = useState(initialJob?.categoryCode ?? '');
  const [description, setDescription] = useState(initialJob?.description ?? '');
  const [jobType, setJobType] = useState<JobType>(initialJob?.jobType ?? 'FULL_TIME');
  const [shift, setShift] = useState<ShiftType>(initialJob?.shift ?? 'DAY');
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

  // ── Location: pin on the map, address/city autofilled by reverse geocode ──
  const saved = initialJob?.locations[0] ?? null;
  const [pin, setPin] = useState<LatLng | null>(saved?.location ?? null);
  const [addressLine, setAddressLine] = useState(saved?.addressLine ?? '');
  const [cityCode, setCityCode] = useState(saved?.cityCode ?? '');
  const [cities, setCities] = useState<CityOption[]>([]);
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([]);
  const [geocoding, setGeocoding] = useState(false);
  /** True while the address text is machine-filled (so a new pin may replace it). */
  const autoFilled = useRef(!saved?.addressLine);

  // ── Experience & Requirements ────────────────────────────────────────
  const [minExperience, setMinExperience] = useState(
    initialJob?.requirements?.minExperienceYears != null
      ? String(initialJob.requirements.minExperienceYears)
      : '',
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
    initialJob?.annualLeaveDays != null ? String(initialJob.annualLeaveDays) : '',
  );
  const [medicalCoverage, setMedicalCoverage] = useState<MedicalCoverageType>(
    (initialJob?.medicalCoverage as MedicalCoverageType) ?? 'NONE',
  );
  const [bonusTier, setBonusTier] = useState<BonusTier>(
    (initialJob?.bonusTier as BonusTier) ?? 'NONE',
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
    ])
      .then(([cityRes, catRes]) => {
        if (cancelled) return;
        setCities(cityRes.data.map((c) => ({ value: c.code, label: c.label })));
        setCategories(catRes.data.map((c) => ({ value: c.code, label: c.label })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Pin change → reverse geocode → autofill address + city (debounced).
  useEffect(() => {
    if (!pin || cities.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setGeocoding(true);
      try {
        const { data } = await apiFetch<ReverseResult>(
          `/api/v1/geocode/reverse?lat=${pin.lat}&lng=${pin.lng}`,
          { signal: controller.signal },
        );
        if (autoFilled.current || !addressLine) setAddressLine(data.addressLine || addressLine);
        if (data.cityCode) setCityCode(data.cityCode);
      } catch {
        // Offline or Nominatim down: keep whatever the employer typed.
      } finally {
        setGeocoding(false);
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on pin/cities only; addressLine read at fire time
  }, [pin, cities]);

  function handleSubmit() {
    startTransition(async () => {
      setError(null);
      try {
        const basicBody = {
          title: title.trim(),
          categoryCode: categoryCode.trim(),
          description: description.trim(),
          jobType,
          shift,
          genderPreference,
          vacancies: parseInt(vacancies, 10),
          salaryMin: salaryMin ? parseInt(salaryMin, 10) : undefined,
          salaryMax: salaryMax ? parseInt(salaryMax, 10) : undefined,
          fuelAllowance,
          flexibleHours,
          annualLeaveDays: annualLeaveDays ? parseInt(annualLeaveDays, 10) : undefined,
          medicalCoverage,
          bonusTier,
          workFromHome,
          providentFund,
          transportAllowance,
          eobi,
          lifeInsurance,
        };

        let jobId: string;
        if (isNew) {
          const { data: created } = await apiFetch<JobView>('/api/v1/jobs/me', {
            method: 'POST',
            body: basicBody,
          });
          jobId = created.id;
        } else {
          const { data: updated } = await apiFetch<JobView>(`/api/v1/jobs/me/${initialJob.id}`, {
            method: 'PATCH',
            body: basicBody,
          });
          jobId = updated.id;
        }

        if (pin && addressLine.trim().length >= 3 && cityCode) {
          await apiFetch<JobView>(`/api/v1/jobs/me/${jobId}/location`, {
            method: 'PUT',
            body: {
              location: pin,
              addressLine: addressLine.trim(),
              cityCode,
            },
          });
        }

        if (isNew) router.push(`/employer/jobs/${jobId}`);
        else router.refresh();
      } catch (e) {
        setError(friendlyError(e));
      }
    });
  }

  const locationReady = pin && addressLine.trim().length >= 3 && cityCode;

  return (
    <div className="grid w-full gap-8">
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
          <FormField label="Job title" required>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior Accountant"
            />
          </FormField>

          <FormField label="Category" required>
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

          <FormField label="Job description" required>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="Describe the role, responsibilities, and what you are looking for…"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Job type" required>
              <Select
                options={JOB_TYPE_OPTIONS}
                value={jobType}
                onChange={(e) => setJobType(e.target.value as JobType)}
              />
            </FormField>
            <FormField label="Shift" required>
              <Select
                options={SHIFT_OPTIONS}
                value={shift}
                onChange={(e) => setShift(e.target.value as ShiftType)}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Gender preference">
              <Select
                options={GENDER_OPTIONS}
                value={genderPreference}
                onChange={(e) => setGenderPreference(e.target.value as GenderPreference)}
              />
            </FormField>
            <FormField label="Vacancies" required>
              <Input
                type="number"
                min={1}
                value={vacancies}
                onChange={(e) => setVacancies(e.target.value)}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Min salary (PKR/month)">
              <Input
                type="number"
                min={0}
                value={salaryMin}
                onChange={(e) => setSalaryMin(e.target.value)}
                placeholder="Optional"
              />
            </FormField>
            <FormField label="Max salary (PKR/month)">
              <Input
                type="number"
                min={0}
                value={salaryMax}
                onChange={(e) => setSalaryMax(e.target.value)}
                placeholder="Optional"
              />
            </FormField>
          </div>
        </Section>

        {/* ─── Experience & Requirements ───────────────────────────────── */}
        <Section title="Experience & Requirements">
          <FormField
            label="Minimum experience required"
            hint="Leave blank if no experience is required"
          >
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={0}
                max={50}
                value={minExperience}
                onChange={(e) => setMinExperience(e.target.value)}
                placeholder="0"
                className="w-28"
              />
              <span className="text-fg-muted text-sm">years</span>
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
                    value={s.minLevel}
                    onChange={(e) => updateSkillLevel(s.skillCode, e.target.value as SkillLevel)}
                    className="text-fg-muted bg-transparent text-xs focus:outline-none"
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
                    className="text-fg-subtle hover:text-danger ml-1 transition-colors"
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
            <FormField label="Medical coverage">
              <Select
                options={MEDICAL_OPTIONS}
                value={medicalCoverage}
                onChange={(e) => setMedicalCoverage(e.target.value as MedicalCoverageType)}
              />
            </FormField>

            <FormField label="Annual leave (days / year)">
              <Input
                type="number"
                min={0}
                max={365}
                value={annualLeaveDays}
                onChange={(e) => setAnnualLeaveDays(e.target.value)}
                placeholder="e.g. 15"
              />
            </FormField>
          </div>

          <FormField label="Performance bonus">
            <Select
              options={BONUS_OPTIONS}
              value={bonusTier}
              onChange={(e) => setBonusTier(e.target.value as BonusTier)}
            />
          </FormField>

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
              Tap the job site on the map — we will fill in the address for you. Matching uses this
              pin to rank nearby applicants.
            </p>
          </div>

          <MapPinPicker value={pin} onChange={setPin} label="Job site location" height="18rem" />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Address"
              hint={
                geocoding ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner className="size-3" /> Looking up the address…
                  </span>
                ) : pin ? (
                  'Autofilled from the map — edit if needed.'
                ) : (
                  'Place the pin on the map first.'
                )
              }
              className="sm:col-span-2"
            >
              <Input
                value={addressLine}
                onChange={(e) => {
                  setAddressLine(e.target.value);
                  autoFilled.current = false;
                }}
                placeholder="House, street and block"
              />
            </FormField>

            <FormField
              label="City"
              hint={pin && !cityCode ? 'Could not match a city — pick it manually.' : undefined}
            >
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
              The location is saved once you place a pin, fill the address (3+ characters) and pick
              a city — required before publishing.
            </p>
          )}
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="flex justify-end gap-3 pb-4">
          <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={pending} disabled={!isReady || pending}>
            {isNew ? 'Create draft' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
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
