'use client';

import {
  JOB_TYPE_LABELS,
  JOB_TYPES,
  preferencesSchema,
  SHIFT_LABELS,
  SHIFTS,
  type JobType,
  type Shift,
} from '@jobbank/shared';
import { useState } from 'react';
import { Checkbox, Input } from '@/components/atoms';
import { DateTimePicker, FormField } from '@/components/molecules';
import type { ApplicantProfile } from '@/domains/applicant';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import {
  errorMessage,
  toFieldErrors,
  zodFieldErrors,
  type FieldErrors,
} from '../../_components/applicants/form';
import { numberOrNull, useStepSave, type StepProps } from './step';

function toggle<T>(list: T[], value: T, on: boolean): T[] {
  return on ? [...new Set([...list, value])] : list.filter((v) => v !== value);
}

function CheckboxGroup<T extends string>({
  legend,
  error,
  options,
  value,
  onChange,
  columns = 2,
}: {
  legend: string;
  error?: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (value: T[]) => void;
  columns?: 2 | 3;
}) {
  return (
    <fieldset className="grid gap-3">
      <legend className="text-fg mb-1 text-sm font-medium">{legend}</legend>
      <div className={columns === 3 ? 'grid gap-3 sm:grid-cols-3' : 'grid gap-3 sm:grid-cols-2'}>
        {options.map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            checked={value.includes(option.value)}
            onCheckedChange={(checked) => onChange(toggle(value, option.value, checked === true))}
          />
        ))}
      </div>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function PreferencesStep({ profile, lists, bindSave }: StepProps) {
  const p = profile?.preferences;
  const [categories, setCategories] = useState<string[]>(p?.categoryCodes ?? []);
  const [shifts, setShifts] = useState<Shift[]>(p?.shifts ?? []);
  const [jobTypes, setJobTypes] = useState<JobType[]>(p?.jobTypes ?? []);
  const [minSalary, setMinSalary] = useState(p?.minSalaryPkr?.toString() ?? '');
  const [availableFrom, setAvailableFrom] = useState(p?.availableFrom ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);

  useStepSave(bindSave, async () => {
    setAlert(null);
    const parsed = preferencesSchema.safeParse({
      categoryCodes: categories,
      shifts,
      jobTypes,
      minSalaryPkr: numberOrNull(minSalary),
      availableFrom: availableFrom || null,
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return null;
    }
    setErrors({});
    try {
      const { data } = await apiFetch<ApplicantProfile>('/api/v1/applicants/me/preferences', {
        method: 'PUT',
        body: parsed.data,
      });
      return data;
    } catch (err) {
      if (err instanceof ApiClientError && err.issues.length > 0)
        setErrors(toFieldErrors(err.issues));
      else setAlert(errorMessage(err));
      return null;
    }
  });

  return (
    <div className="grid gap-6">
      {alert && (
        <p role="alert" className="bg-danger-soft text-danger-soft-fg rounded-lg px-4 py-3 text-sm">
          {alert}
        </p>
      )}
      <CheckboxGroup
        legend="What kind of work are you looking for? *"
        error={errors.categoryCodes}
        options={lists.categories}
        value={categories}
        onChange={setCategories}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Lowest monthly salary you would accept"
          error={errors.minSalaryPkr}
          hint="In rupees. Leave empty if you are flexible."
        >
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            startAdornment={<span className="text-fg-muted text-sm">Rs</span>}
            value={minSalary}
            onChange={(e) => setMinSalary(e.target.value)}
          />
        </FormField>
        <FormField label="Available from" error={errors.availableFrom} hint="Leave empty if now.">
          <DateTimePicker
            mode="date"
            value={availableFrom}
            onChange={(iso) => setAvailableFrom(iso)}
          />
        </FormField>
      </div>
      <CheckboxGroup
        legend="Shifts you can work"
        options={SHIFTS.map((s) => ({ value: s, label: SHIFT_LABELS[s] }))}
        value={shifts}
        onChange={setShifts}
      />
      <CheckboxGroup
        legend="Types of job"
        columns={3}
        options={JOB_TYPES.map((t) => ({ value: t, label: JOB_TYPE_LABELS[t] }))}
        value={jobTypes}
        onChange={setJobTypes}
      />
    </div>
  );
}
