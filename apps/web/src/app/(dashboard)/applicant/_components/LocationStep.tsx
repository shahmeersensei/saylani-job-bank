'use client';

import { applicantLocationSchema } from '@jobbank/shared';
import { useState } from 'react';
import { Input, Select } from '@/components/atoms';
import { FormField, GeocodeAddressPicker } from '@/components/molecules';
import type { ApplicantProfile } from '@/domains/applicant';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import {
  errorMessage,
  toFieldErrors,
  zodFieldErrors,
  type FieldErrors,
} from '../../_components/applicants/form';
import { useStepSave, type StepProps } from './step';

export function LocationStep({ profile, lists, bindSave }: StepProps) {
  const address = profile?.address;
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(address?.location ?? null);
  const [form, setForm] = useState({
    addressLine: address?.addressLine ?? '',
    cityCode: address?.cityCode ?? '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const set = (changes: Partial<typeof form>) => setForm((f) => ({ ...f, ...changes }));

  useStepSave(bindSave, async () => {
    setAlert(null);
    const parsed = applicantLocationSchema.safeParse({
      location: pin ?? undefined,
      addressLine: form.addressLine,
      cityCode: form.cityCode || undefined,
    });
    if (!parsed.success) {
      const next = zodFieldErrors(parsed.error);
      if (!pin) next.location = 'Search for your home area and pick a match from the list';
      setErrors(next);
      return null;
    }
    setErrors({});
    try {
      const { data } = await apiFetch<ApplicantProfile>('/api/v1/applicants/me/location', {
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

  const pinError = errors.location ?? errors['location.lat'] ?? errors['location.lng'];

  return (
    <div className="grid gap-5">
      {alert && (
        <p role="alert" className="bg-danger-soft text-danger-soft-fg rounded-lg px-4 py-3 text-sm">
          {alert}
        </p>
      )}

      <GeocodeAddressPicker
        value={pin}
        onChange={setPin}
        onPick={(result) => {
          // The city is a seeded-code select: only fill it when the
          // geocoder matched one of the seeded cities.
          if (result.cityCode && lists.cities.some((c) => c.value === result.cityCode)) {
            set({ cityCode: result.cityCode });
          }
          if (result.addressLine && !form.addressLine) {
            set({ addressLine: result.addressLine });
          }
        }}
        cityCode={form.cityCode || null}
        cityLabel={lists.cities.find((c) => c.value === form.cityCode)?.label ?? null}
        label="Your home location"
        hint="Search your area, street or a nearby landmark, then pick a match. The exact house address below stays private to Job Bank staff."
        initialQuery={address?.addressLine ?? ''}
        required
        error={pinError}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Address"
          error={errors.addressLine}
          hint="Optional. House, street, area or nearest landmark. Only Job Bank staff can see it."
          className="sm:col-span-2"
        >
          <Input
            autoComplete="street-address"
            placeholder="e.g. House 12, Street 4, Block 13-D (optional)"
            value={form.addressLine}
            onChange={(e) => set({ addressLine: e.target.value })}
          />
        </FormField>
        <FormField label="City" required error={errors.cityCode} className="sm:col-span-2">
          <Select
            placeholder="Choose your city"
            value={form.cityCode}
            onChange={(e) => set({ cityCode: e.target.value })}
            options={lists.cities}
          />
        </FormField>
      </div>
    </div>
  );
}
