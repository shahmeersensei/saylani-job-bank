'use client';

import { counterRegisterSchema, GENDER_LABELS, GENDERS } from '@jobbank/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, Input, Select } from '@/components/atoms';
import { DateTimePicker, FormField, PhoneInput, toast } from '@/components/molecules';
import { ApiClientError, apiFetch, friendlyApiError } from '@/lib/api/client';
import { zodFieldErrors, type FieldErrors } from '../applicants/form';

const EMPTY = { fullName: '', fatherName: '', cnic: '', dateOfBirth: '', gender: '' };

/** Built for a tablet or phone at an outdoor counter: one column, large controls. */
export function CounterRegisterForm({ basePath }: { basePath: string }) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [phone, setPhone] = useState({ national: '', e164: null as string | null });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setAlert(null);
    const next: FieldErrors = {};
    if (phone.national && !phone.e164) next.phone = 'Enter a valid Pakistani mobile number';
    const parsed = counterRegisterSchema.safeParse({
      ...form,
      phone: phone.e164,
      consentConfirmed: consent,
    });
    if (!parsed.success) Object.assign(next, zodFieldErrors(parsed.error));
    setErrors(next);
    if (!parsed.success || Object.keys(next).length) return;

    setSaving(true);
    try {
      // Counter registration lives on its own path: POST /api/v1/applicants is the
      // staff-assisted account flow, not the walk-in counter flow.
      const { data } = await apiFetch<{ id: string }>('/api/v1/applicants/counter', {
        method: 'POST',
        body: parsed.data,
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success('Candidate registered');
      router.push(`${basePath}/${data.id}/complete`);
    } catch (err) {
      if (err instanceof ApiClientError && err.issues.length) {
        // Audit 2026-11-11 (M-03): issues for fields this form does not
        // render (e.g. branchId — "Choose a branch first" when the actor
        // has no resolvable branch) had nowhere to display, so submit
        // silently died. Field issues still land on their fields; the
        // rest become the alert at the bottom of the form.
        const rendered = new Set([
          'fullName',
          'fatherName',
          'cnic',
          'dateOfBirth',
          'gender',
          'phone',
          'consentConfirmed',
        ]);
        const fieldIssues = err.issues.filter((i) => rendered.has(i.path));
        const otherIssues = err.issues.filter((i) => !rendered.has(i.path));
        setErrors(Object.fromEntries(fieldIssues.map((i) => [i.path, i.message])));
        if (otherIssues.length > 0) {
          setAlert(otherIssues.map((i) => i.message).join(' '));
        }
      } else {
        setAlert(friendlyApiError(err));
      }
      setSaving(false);
    }
  }

  return (
    <form className="grid w-full max-w-xl gap-4" onSubmit={(e) => void submit(e)} noValidate>
      <FormField label="Full name (as on CNIC)" required error={errors.fullName}>
        <Input
          size="lg"
          autoComplete="off"
          value={form.fullName}
          onChange={(e) => set('fullName')(e.target.value)}
        />
      </FormField>
      <FormField label="Father's or husband's name" required error={errors.fatherName}>
        <Input
          size="lg"
          autoComplete="off"
          value={form.fatherName}
          onChange={(e) => set('fatherName')(e.target.value)}
        />
      </FormField>
      <FormField label="CNIC number" required error={errors.cnic} hint="13 digits, without dashes.">
        <Input
          size="lg"
          inputMode="numeric"
          autoComplete="off"
          value={form.cnic}
          onChange={(e) => set('cnic')(e.target.value.replace(/\D/g, '').slice(0, 13))}
        />
      </FormField>
      <FormField label="Date of birth" required error={errors.dateOfBirth}>
        <DateTimePicker
          mode="date"
          size="lg"
          value={form.dateOfBirth}
          onChange={(iso) => set('dateOfBirth')(iso)}
        />
      </FormField>
      <FormField label="Gender" required error={errors.gender}>
        <Select
          size="lg"
          placeholder="Choose"
          value={form.gender}
          onChange={(e) => set('gender')(e.target.value)}
          options={GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))}
        />
      </FormField>
      <FormField
        label="Mobile number"
        error={errors.phone}
        hint="Optional. It can be a family member's number. Without one, the candidate checks in at the branch."
      >
        <PhoneInput size="lg" onChange={(c) => setPhone({ national: c.national, e164: c.e164 })} />
      </FormField>
      <div className="grid gap-1">
        <Checkbox
          label="The candidate agreed to register, and has signed the paper consent form"
          checked={consent}
          onCheckedChange={(v) => setConsent(v === true)}
        />
        {errors.consentConfirmed && (
          <p className="text-danger text-sm" role="alert">
            Confirm that the candidate agreed
          </p>
        )}
      </div>
      {alert && (
        <p role="alert" className="bg-danger-soft text-danger-soft-fg rounded-lg px-3 py-2 text-sm">
          {alert}
        </p>
      )}
      <Button type="submit" size="lg" fullWidth loading={saving}>
        Register and continue
      </Button>
    </form>
  );
}
