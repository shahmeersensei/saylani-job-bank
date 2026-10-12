'use client';

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
} from '@jobbank/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Input, Select, Textarea } from '@/components/atoms';
import { FormField, toast } from '@/components/molecules';
import { apiFetch } from '@/lib/api/client';
import { ApiClientError } from '@/lib/api/client';

interface Props {
  companies: { id: string; name: string }[];
  categories: { code: string; label: string }[];
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

export function StaffPostJobForm({ companies, categories }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [companyId, setCompanyId] = useState('');
  const [title, setTitle] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [description, setDescription] = useState('');
  const [jobType, setJobType] = useState('FULL_TIME');
  const [shift, setShift] = useState('DAY');
  const [genderPreference, setGenderPreference] = useState('ANY');
  const [vacancies, setVacancies] = useState('1');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Benefits & Perks
  const [fuelAllowance, setFuelAllowance] = useState(false);
  const [flexibleHours, setFlexibleHours] = useState(false);
  const [annualLeaveDays, setAnnualLeaveDays] = useState('');
  const [medicalCoverage, setMedicalCoverage] = useState('NONE');
  const [bonusTier, setBonusTier] = useState('NONE');
  const [workFromHome, setWorkFromHome] = useState(false);
  const [providentFund, setProvidentFund] = useState(false);
  const [transportAllowance, setTransportAllowance] = useState(false);
  const [eobi, setEobi] = useState(false);
  const [lifeInsurance, setLifeInsurance] = useState(false);

  const categoryOptions = categories.map((c) => ({ value: c.code, label: c.label }));
  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name }));

  function handleSubmit() {
    startTransition(async () => {
      setError(null);
      try {
        await apiFetch('/api/v1/jobs', {
          method: 'POST',
          body: {
            companyId,
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
          },
        });
        toast.success('Job created as draft');
        router.push('/branch-admin/jobs');
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'Something went wrong');
      }
    });
  }

  return (
    <div className="border-border bg-surface grid max-w-2xl gap-6 rounded-xl border p-6">
      {companies.length === 0 ? (
        <p className="text-fg-muted text-sm">
          No verified companies in your branch yet. Companies must be verified before you can post
          jobs for them.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Company" required className="sm:col-span-2">
              <Select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                placeholder="Select a company"
                options={companyOptions}
              />
            </FormField>
            <FormField label="Job title" required className="sm:col-span-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Senior Accountant"
              />
            </FormField>
            <FormField label="Category" required>
              <Select
                value={categoryCode}
                onChange={(e) => setCategoryCode(e.target.value)}
                placeholder="Select category"
                options={categoryOptions}
              />
            </FormField>
            <FormField label="Job type" required>
              <Select
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
                options={JOB_TYPE_OPTIONS}
              />
            </FormField>
            <FormField label="Shift" required>
              <Select
                value={shift}
                onChange={(e) => setShift(e.target.value)}
                options={SHIFT_OPTIONS}
              />
            </FormField>
            <FormField label="Gender preference">
              <Select
                value={genderPreference}
                onChange={(e) => setGenderPreference(e.target.value)}
                options={GENDER_OPTIONS}
              />
            </FormField>
            <FormField label="Vacancies" required>
              <Input
                type="number"
                min="1"
                max="9999"
                value={vacancies}
                onChange={(e) => setVacancies(e.target.value)}
              />
            </FormField>
            <FormField label="Salary min (PKR/mo)">
              <Input
                type="number"
                min="0"
                value={salaryMin}
                onChange={(e) => setSalaryMin(e.target.value)}
                placeholder="Optional"
              />
            </FormField>
            <FormField label="Salary max (PKR/mo)">
              <Input
                type="number"
                min="0"
                value={salaryMax}
                onChange={(e) => setSalaryMax(e.target.value)}
                placeholder="Optional"
              />
            </FormField>
            <div className="border-border rounded-xl border p-4 sm:col-span-2">
              <h3 className="text-fg mb-3 text-sm font-medium">Benefits &amp; Perks</h3>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Medical coverage">
                    <Select
                      options={MEDICAL_OPTIONS}
                      value={medicalCoverage}
                      onChange={(e) => setMedicalCoverage(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Bonus">
                    <Select
                      options={BONUS_OPTIONS}
                      value={bonusTier}
                      onChange={(e) => setBonusTier(e.target.value)}
                    />
                  </FormField>
                </div>
                <FormField label="Annual leave (days/year)">
                  <Input
                    type="number"
                    min="0"
                    max="365"
                    value={annualLeaveDays}
                    onChange={(e) => setAnnualLeaveDays(e.target.value)}
                    placeholder="e.g. 15"
                  />
                </FormField>
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
            <FormField label="Description" required className="sm:col-span-2">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the role, responsibilities and requirements…"
                rows={5}
              />
            </FormField>
          </div>
          {error && <p className="text-danger text-sm">{error}</p>}
          <div className="flex gap-3">
            <Button
              onClick={handleSubmit}
              loading={pending}
              disabled={!companyId || !title || !categoryCode || !description || !vacancies}
            >
              Create job draft
            </Button>
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
