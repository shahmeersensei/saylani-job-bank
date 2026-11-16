'use client';

import {
  GENDER_LABELS,
  GENDERS,
  MIN_APPLICANT_AGE,
  registerApplicantSchema,
  type Gender,
} from '@jobbank/shared';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { Input, RadioGroup } from '@/components/atoms';
import { CNICInput, DateTimePicker, FormField } from '@/components/molecules';
import type { ApplicantProfile } from '@/domains/applicant';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import {
  errorMessage,
  toFieldErrors,
  zodFieldErrors,
  type FieldErrors,
} from '../../_components/applicants/form';
import { useStepSave, type StepProps } from './step';

const latestBirthDate = () => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - MIN_APPLICANT_AGE);
  return d.toISOString().slice(0, 10);
};

export function PersonalStep({ profile, bindSave }: StepProps) {
  const p = profile?.personal;
  const [form, setForm] = useState({
    fullName: p?.fullName ?? '',
    fatherName: p?.fatherName ?? '',
    cnic: p?.cnic ?? '',
    dateOfBirth: p?.dateOfBirth ?? '',
    gender: (p?.gender ?? '') as Gender | '',
    email: p?.email ?? '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const locked = profile?.identityLocked ?? false;
  const set = (changes: Partial<typeof form>) => setForm((f) => ({ ...f, ...changes }));

  useStepSave(bindSave, async () => {
    setAlert(null);
    const parsed = registerApplicantSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return null;
    }
    setErrors({});
    try {
      const { data } = profile
        ? await apiFetch<ApplicantProfile>('/api/v1/applicants/me', {
            method: 'PATCH',
            body: locked ? { gender: parsed.data.gender, email: parsed.data.email } : parsed.data,
          })
        : await apiFetch<ApplicantProfile>('/api/v1/applicants/register', {
            method: 'POST',
            body: parsed.data,
            idempotencyKey: crypto.randomUUID(),
          });
      return data;
    } catch (err) {
      if (err instanceof ApiClientError && err.issues.length > 0) {
        setErrors(toFieldErrors(err.issues));
      } else {
        setAlert(errorMessage(err));
      }
      return null;
    }
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {alert && (
        <p
          role="alert"
          className="bg-danger-soft text-danger-soft-fg rounded-lg px-4 py-3 text-sm sm:col-span-2"
        >
          {alert}
        </p>
      )}
      {locked && (
        <p className="bg-surface-muted text-fg-muted flex items-start gap-2 rounded-lg px-4 py-3 text-sm sm:col-span-2">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Your identity has been verified, so your CNIC, names and date of birth are locked. Ask
          your branch if something needs correcting.
        </p>
      )}
      <FormField
        label="Full name"
        required
        error={errors.fullName}
        disabled={locked}
        className="sm:col-span-2"
      >
        <Input
          autoComplete="name"
          value={form.fullName}
          onChange={(e) => set({ fullName: e.target.value })}
        />
      </FormField>
      <FormField
        label="Father's or husband's name"
        required
        error={errors.fatherName}
        disabled={locked}
        className="sm:col-span-2"
      >
        <Input value={form.fatherName} onChange={(e) => set({ fatherName: e.target.value })} />
      </FormField>
      <FormField
        label="CNIC number"
        required
        error={errors.cnic}
        disabled={locked}
        hint="The 13 digits on your national identity card."
      >
        <CNICInput value={form.cnic} onChange={(c) => set({ cnic: c.digits })} />
      </FormField>
      <FormField
        label="Date of birth"
        required
        error={errors.dateOfBirth}
        disabled={locked}
        hint={`You must be at least ${MIN_APPLICANT_AGE}.`}
      >
        <DateTimePicker
          mode="date"
          max={latestBirthDate()}
          min="1940-01-01"
          value={form.dateOfBirth}
          onChange={(iso) => set({ dateOfBirth: iso })}
        />
      </FormField>
      <FormField label="Gender" required error={errors.gender}>
        <RadioGroup
          aria-label="Gender"
          orientation="horizontal"
          value={form.gender}
          onValueChange={(value) => set({ gender: value as Gender })}
          options={GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))}
        />
      </FormField>
      <FormField label="Email" error={errors.email} hint="Optional. We use it only to contact you.">
        <Input
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => set({ email: e.target.value })}
        />
      </FormField>
    </div>
  );
}
