'use client';

import { applicantLocationSchema } from '@jobbank/shared';
import { useState } from 'react';
import { Input, Select } from '@/components/atoms';
import { FormField } from '@/components/molecules';
import { MapPinPicker, type LatLng } from '@/components/organisms';
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
  const [pin, setPin] = useState<LatLng | null>(address?.location ?? null);
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
      if (!pin) next.location = 'Tap your home on the map';
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

      <div className="grid gap-2">
        <p className="text-fg text-sm font-medium">
          Your home on the map <span className="text-danger">*</span>
        </p>
        <MapPinPicker
          value={pin}
          onChange={setPin}
          onLocate={(coords, addressLine) => {
            setPin(coords);
            if (addressLine) set({ addressLine });
          }}
          label="Your home location"
          height="18rem"
        />
        {pinError && (
          <p role="alert" className="text-danger text-sm">
            {pinError}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Address"
          required
          error={errors.addressLine}
          hint="House, street and block. Only Job Bank staff can see it."
          className="sm:col-span-2"
        >
          <Input
            autoComplete="street-address"
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
