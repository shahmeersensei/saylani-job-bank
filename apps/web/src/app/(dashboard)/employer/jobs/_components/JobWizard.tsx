'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, useTransition } from 'react';
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
import type { JobView } from '@/domains/job/repository';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { Button, Input, Select, Textarea } from '@/components/atoms';
import { FormField } from '@/components/molecules';
import { useRouter } from 'next/navigation';
import { MapPin, Plus, X } from 'lucide-react';

const JobLocationMap = dynamic(() => import('./JobLocationMap'), { ssr: false });

// ─── Option arrays ──────────────────────────────────────────────────────

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

interface MasterDataItem {
  code: string;
  label: string;
}

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

  // ── Master data ──────────────────────────────────────────────────────
  const [categories, setCategories] = useState<MasterDataItem[]>([]);
  const [availableSkills, setAvailableSkills] = useState<MasterDataItem[]>([]);

  useEffect(() => {
    apiFetch<MasterDataItem[]>('/api/v1/master-data?type=JOB_CATEGORY')
      .then((r) => setCategories(r.data))
      .catch(() => undefined);
    apiFetch<MasterDataItem[]>('/api/v1/master-data?type=SKILL')
      .then((r) => setAvailableSkills(r.data))
      .catch(() => undefined);
  }, []);

  // ── Requirements ─────────────────────────────────────────────────────
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
      minLevel: s.minLevel,
      required: s.required,
    })),
  );
  const [pickLabel, setPickLabel] = useState('');
  const [pickLevel, setPickLevel] = useState<SkillLevel>('BEGINNER');

  function addSkill() {
    const trimmed = pickLabel.trim();
    if (!trimmed) return;
    const code = trimmed.toUpperCase().replace(/\s+/g, '_');
    if (skills.some((s) => s.skillCode === code)) return;
    setSkills((prev) => [
      ...prev,
      { skillCode: code, label: trimmed, minLevel: pickLevel, required: true },
    ]);
    setPickLabel('');
    setPickLevel('BEGINNER');
  }

  function handleSkillKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSkill();
    }
  }

  function removeSkill(code: string) {
    setSkills((prev) => prev.filter((s) => s.skillCode !== code));
  }

  function updateSkillLevel(code: string, level: SkillLevel) {
    setSkills((prev) => prev.map((s) => (s.skillCode === code ? { ...s, minLevel: level } : s)));
  }

  // ── Location ─────────────────────────────────────────────────────────
  const existingLoc = initialJob?.locations[0];
  const [addressLine, setAddressLine] = useState(existingLoc?.addressLine ?? '');
  const [locationCity, setLocationCity] = useState(existingLoc?.cityCode ?? '');
  const [lat, setLat] = useState(0);
  const [lng, setLng] = useState(0);
  const [showMap, setShowMap] = useState(false);

  function handleMapPick(pickedLat: number, pickedLng: number) {
    setLat(pickedLat);
    setLng(pickedLng);
  }

  // ── Benefits & Perks ─────────────────────────────────────────────────
  const [fuelAllowance, setFuelAllowance] = useState(initialJob?.fuelAllowance ?? false);
  const [flexibleHours, setFlexibleHours] = useState(initialJob?.flexibleHours ?? false);
  const [annualLeaveDays, setAnnualLeaveDays] = useState(
    initialJob?.annualLeaveDays != null ? String(initialJob.annualLeaveDays) : '',
  );
  const [medicalCoverage, setMedicalCoverage] = useState<MedicalCoverageType>(
    initialJob?.medicalCoverage ?? 'NONE',
  );
  const [bonusTier, setBonusTier] = useState<BonusTier>(initialJob?.bonusTier ?? 'NONE');
  const [workFromHome, setWorkFromHome] = useState(initialJob?.workFromHome ?? false);
  const [providentFund, setProvidentFund] = useState(initialJob?.providentFund ?? false);
  const [transportAllowance, setTransportAllowance] = useState(
    initialJob?.transportAllowance ?? false,
  );
  const [eobi, setEobi] = useState(initialJob?.eobi ?? false);
  const [lifeInsurance, setLifeInsurance] = useState(initialJob?.lifeInsurance ?? false);

  // ── Submit ────────────────────────────────────────────────────────────

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
          await apiFetch<JobView>(`/api/v1/jobs/me/${initialJob.id}`, {
            method: 'PATCH',
            body: basicBody,
          });
          jobId = initialJob.id;
        }

        // Save sub-resources in parallel
        await Promise.all([
          // Requirements: save if any value is filled
          minExperience || otherRequirements
            ? apiFetch(`/api/v1/jobs/me/${jobId}/requirements`, {
                method: 'PUT',
                body: {
                  minExperienceYears: minExperience ? parseInt(minExperience, 10) : undefined,
                  otherRequirements: otherRequirements || undefined,
                },
              })
            : undefined,
          // Skills
          apiFetch(`/api/v1/jobs/me/${jobId}/skills`, {
            method: 'PUT',
            body: {
              skills: skills.map((s) => ({
                skillCode: s.skillCode,
                minLevel: s.minLevel,
                required: s.required,
              })),
            },
          }),
          // Location: save only if address and city are filled
          addressLine.trim() && locationCity.trim()
            ? apiFetch(`/api/v1/jobs/me/${jobId}/location`, {
                method: 'PUT',
                body: {
                  addressLine: addressLine.trim(),
                  cityCode: locationCity.trim(),
                  ...(lat !== 0 || lng !== 0 ? { location: { lat, lng } } : {}),
                },
              })
            : undefined,
        ]);

        if (isNew) {
          router.push(`/employer/jobs/${jobId}`);
        } else {
          router.refresh();
        }
      } catch (e) {
        setError(friendlyError(e));
      }
    });
  }

  const isReady =
    title.trim().length >= 3 && categoryCode.trim() && description.trim().length >= 10;

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
                options={categories.map((c) => ({ value: c.code, label: c.label }))}
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

        {/* ─── Location ───────────────────────────────────────────────── */}
        <Section
          title="Job Location"
          hint="Where will the candidate work? Leave blank to use the company's head office."
        >
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Address" hint="Building, street, area">
              <Input
                value={addressLine}
                onChange={(e) => setAddressLine(e.target.value)}
                placeholder="e.g. 2nd Floor, Al-Hafeez Plaza, Gulberg"
              />
            </FormField>
            <FormField label="City">
              <Input
                value={locationCity}
                onChange={(e) => setLocationCity(e.target.value)}
                placeholder="e.g. Karachi"
              />
            </FormField>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowMap((v) => !v)}
              className="text-primary flex items-center gap-1.5 text-sm font-medium hover:underline"
            >
              <MapPin className="size-4" />
              {showMap ? 'Hide map' : 'Pin on map (optional)'}
            </button>

            {showMap && (
              <div
                className="mt-3 overflow-hidden rounded-xl border"
                style={{ borderColor: 'var(--border)' }}
              >
                <JobLocationMap lat={lat} lng={lng} onPick={handleMapPick} />
                {(lat !== 0 || lng !== 0) && (
                  <p className="text-fg-muted px-3 py-2 text-xs">
                    Pinned: {lat.toFixed(5)}, {lng.toFixed(5)} — click anywhere on the map to move
                    it
                  </p>
                )}
              </div>
            )}
          </div>
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
