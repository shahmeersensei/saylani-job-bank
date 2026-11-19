'use client';

import {
  GENDER_PREFERENCES,
  GENDER_PREFERENCE_LABELS,
  JOB_POSTING_SHIFT_TYPES,
  JOB_TYPES,
  JOB_TYPE_LABELS,
  SHIFT_TYPE_LABELS,
  type GenderPreference,
  type JobType,
  type ShiftType,
} from '@jobbank/shared';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Button, Input, Select, Textarea } from '@/components/atoms';
import { FormField, toast } from '@/components/molecules';
import type { JobView } from '@/domains/job';
import { ApiClientError, apiFetch, friendlyApiError } from '@/lib/api/client';

export type JobFormCompany = { id: string; name: string };
export type EditableJob = Pick<
  JobView,
  | 'id'
  | 'title'
  | 'categoryCode'
  | 'description'
  | 'jobType'
  | 'shift'
  | 'shiftHours'
  | 'genderPreference'
  | 'vacancies'
  | 'salaryMin'
  | 'salaryMax'
>;

type Props = {
  categories: { code: string; label: string }[];
  companyId?: string;
  companies?: JobFormCompany[];
  job?: EditableJob | null;
  onSaved?: (job: JobView) => void;
  onCancel?: () => void;
  redirectTo?: string;
};

type FormValues = {
  title: string;
  categoryCode: string;
  description: string;
  jobType: JobType;
  shift: ShiftType;
  shiftHours: string;
  genderPreference: GenderPreference;
  vacancies: string;
  salaryMin: string;
  salaryMax: string;
};

const EMPTY: FormValues = {
  title: '',
  categoryCode: '',
  description: '',
  jobType: 'FULL_TIME',
  shift: JOB_POSTING_SHIFT_TYPES[0],
  shiftHours: '',
  genderPreference: 'ANY',
  vacancies: '1',
  salaryMin: '',
  salaryMax: '',
};

export function StaffJobForm({
  categories,
  companyId,
  companies = [],
  job,
  onSaved,
  onCancel,
  redirectTo = '/branch-admin/jobs',
}: Props) {
  const router = useRouter();
  const idempotencyKeys = useRef(new Map<string, string>());
  const [selectedCompanyId, setSelectedCompanyId] = useState(
    companyId ?? (companies.length === 1 ? companies[0]!.id : ''),
  );
  const [form, setForm] = useState<FormValues>(
    job
      ? {
          title: job.title,
          categoryCode: job.categoryCode,
          description: job.description,
          jobType: job.jobType,
          shift: job.shift,
          shiftHours: job.shiftHours == null ? '' : String(job.shiftHours),
          genderPreference: job.genderPreference,
          vacancies: String(job.vacancies),
          salaryMin: job.salaryMin == null ? '' : String(job.salaryMin),
          salaryMax: job.salaryMax == null ? '' : String(job.salaryMax),
        }
      : EMPTY,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = categories.map((item) => ({
    value: item.code,
    label: item.label,
  }));
  const shiftOptions = [
    ...(job && !JOB_POSTING_SHIFT_TYPES.some((shift) => shift === job.shift)
      ? [{ value: job.shift, label: SHIFT_TYPE_LABELS[job.shift] }]
      : []),
    ...JOB_POSTING_SHIFT_TYPES.map((value) => ({
      value,
      label: SHIFT_TYPE_LABELS[value],
    })),
  ];
  const companyOptions = companies.map((item) => ({
    value: item.id,
    label: item.name,
  }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const body = {
      title: form.title.trim(),
      categoryCode: form.categoryCode,
      description: form.description.trim(),
      jobType: form.jobType,
      shift: form.shift,
      shiftHours: form.shiftHours ? Number(form.shiftHours) : undefined,
      genderPreference: form.genderPreference,
      vacancies: Number(form.vacancies),
      salaryMin: form.salaryMin ? Number(form.salaryMin) : undefined,
      salaryMax: form.salaryMax ? Number(form.salaryMax) : undefined,
    };

    try {
      let saved: JobView;
      if (job) {
        const path = companyId
          ? `/api/v1/companies/${companyId}/jobs/${job.id}`
          : `/api/v1/jobs/${job.id}`;
        const { data } = await apiFetch<JobView>(path, {
          method: 'PATCH',
          body: {
            ...body,
            shift: job.shift === form.shift ? undefined : body.shift,
          },
        });
        saved = data;
        toast.success('Job updated');
      } else {
        const targetCompanyId = companyId ?? selectedCompanyId;
        const createBody = companyId ? body : { ...body, companyId: targetCompanyId };
        const fingerprint = JSON.stringify(createBody);
        const key =
          idempotencyKeys.current.get(fingerprint) ??
          (() => {
            const generated = crypto.randomUUID();
            idempotencyKeys.current.set(fingerprint, generated);
            return generated;
          })();
        const path = companyId ? `/api/v1/companies/${companyId}/jobs` : '/api/v1/jobs';
        const { data } = await apiFetch<JobView>(path, {
          method: 'POST',
          body: createBody,
          idempotencyKey: key,
        });
        saved = data;
        idempotencyKeys.current.clear();
        toast.success('Job created as draft');
      }

      onSaved?.(saved);
      if (!onSaved) {
        router.push(redirectTo);
        router.refresh();
      }
    } catch (reason) {
      setError(
        reason instanceof ApiClientError ? friendlyApiError(reason) : 'Could not save this job',
      );
    } finally {
      setPending(false);
    }
  }

  const canSubmit =
    form.title.trim().length >= 3 &&
    Boolean(form.categoryCode) &&
    form.description.trim().length >= 10 &&
    Number(form.vacancies) >= 1 &&
    (form.jobType !== 'ROTATING' ||
      (Number.isInteger(Number(form.shiftHours)) &&
        Number(form.shiftHours) >= 1 &&
        Number(form.shiftHours) <= 24)) &&
    (Boolean(job) || Boolean(companyId) || Boolean(selectedCompanyId));

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      {!job && !companyId && (
        <FormField label="Company" required>
          <Select
            value={selectedCompanyId}
            onChange={(event) => setSelectedCompanyId(event.target.value)}
            options={companyOptions}
            placeholder="Select a verified company"
          />
        </FormField>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Job title" required className="sm:col-span-2">
          <Input
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </FormField>
        <FormField label="Category" required>
          <Select
            value={form.categoryCode}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                categoryCode: event.target.value,
              }))
            }
            options={categoryOptions}
            placeholder="Select category"
          />
        </FormField>
        <FormField label="Job type" required>
          <Select
            value={form.jobType}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                jobType: event.target.value as JobType,
              }))
            }
            options={JOB_TYPES.map((value) => ({
              value,
              label: JOB_TYPE_LABELS[value],
            }))}
          />
        </FormField>
        <FormField label="Shift" required>
          <Select
            value={form.shift}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                shift: event.target.value as ShiftType,
              }))
            }
            options={shiftOptions}
          />
        </FormField>
        {form.jobType === 'ROTATING' && (
          <FormField label="Hours per shift" required>
            <Input
              type="number"
              min="1"
              max="24"
              value={form.shiftHours}
              onChange={(event) =>
                setForm((current) => ({ ...current, shiftHours: event.target.value }))
              }
            />
          </FormField>
        )}
        <FormField label="Gender preference">
          <Select
            value={form.genderPreference}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                genderPreference: event.target.value as GenderPreference,
              }))
            }
            options={GENDER_PREFERENCES.map((value) => ({
              value,
              label: GENDER_PREFERENCE_LABELS[value],
            }))}
          />
        </FormField>
        <FormField label="Vacancies" required>
          <Input
            type="number"
            min="1"
            max="9999"
            value={form.vacancies}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                vacancies: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Salary minimum (PKR/mo)">
          <Input
            type="number"
            min="0"
            value={form.salaryMin}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                salaryMin: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Salary maximum (PKR/mo)">
          <Input
            type="number"
            min="0"
            value={form.salaryMax}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                salaryMax: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Description" required className="sm:col-span-2">
          <Textarea
            rows={5}
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
        </FormField>
      </div>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel ?? (() => router.back())}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={!canSubmit || pending}>
          {job ? 'Save changes' : 'Create job draft'}
        </Button>
      </div>
    </form>
  );
}
