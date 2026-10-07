'use client';

import { useState, useTransition } from 'react';
import {
  JOB_TYPES,
  JOB_TYPE_LABELS,
  SHIFT_TYPES,
  SHIFT_TYPE_LABELS,
  GENDER_PREFERENCES,
  GENDER_PREFERENCE_LABELS,
} from '@jobbank/shared';
import type { JobView } from '@/domains/job/repository';
import { apiFetch } from '@/lib/api/client';
import { Button, Input, Select, Textarea } from '@/components/atoms';
import { FormField } from '@/components/molecules';
import { useRouter } from 'next/navigation';

interface Props {
  initialJob?: JobView | null;
}

const JOB_TYPE_OPTIONS = JOB_TYPES.map((v) => ({ value: v, label: JOB_TYPE_LABELS[v] }));
const SHIFT_OPTIONS = SHIFT_TYPES.map((v) => ({ value: v, label: SHIFT_TYPE_LABELS[v] }));
const GENDER_OPTIONS = GENDER_PREFERENCES.map((v) => ({
  value: v,
  label: GENDER_PREFERENCE_LABELS[v],
}));

export function JobWizard({ initialJob = null }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(initialJob?.title ?? '');
  const [categoryCode, setCategoryCode] = useState(initialJob?.categoryCode ?? '');
  const [description, setDescription] = useState(initialJob?.description ?? '');
  const [jobType, setJobType] = useState<string>(initialJob?.jobType ?? 'FULL_TIME');
  const [shift, setShift] = useState<string>(initialJob?.shift ?? 'DAY');
  const [genderPreference, setGenderPreference] = useState<string>(
    initialJob?.genderPreference ?? 'ANY',
  );
  const [vacancies, setVacancies] = useState(String(initialJob?.vacancies ?? 1));
  const [salaryMin, setSalaryMin] = useState(
    initialJob?.salaryMin != null ? String(initialJob.salaryMin) : '',
  );
  const [salaryMax, setSalaryMax] = useState(
    initialJob?.salaryMax != null ? String(initialJob.salaryMax) : '',
  );

  const isNew = !initialJob;

  function handleSubmit() {
    startTransition(async () => {
      setError(null);
      try {
        const body = {
          title: title.trim(),
          categoryCode: categoryCode.trim(),
          description: description.trim(),
          jobType,
          shift,
          genderPreference,
          vacancies: parseInt(vacancies, 10),
          salaryMin: salaryMin ? parseInt(salaryMin, 10) : undefined,
          salaryMax: salaryMax ? parseInt(salaryMax, 10) : undefined,
        };

        if (isNew) {
          const { data: created } = await apiFetch<JobView>('/api/v1/jobs/me', {
            method: 'POST',
            body,
          });
          router.push(`/employer/jobs/${created.id}`);
        } else {
          await apiFetch<JobView>(`/api/v1/jobs/me/${initialJob.id}`, {
            method: 'PATCH',
            body,
          });
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      }
    });
  }

  return (
    <div className="grid w-full gap-8">
      <header>
        <h1 className="text-fg text-2xl font-semibold">{isNew ? 'Post a new job' : 'Edit job'}</h1>
      </header>

      <div className="grid gap-5">
        <FormField label="Job title" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Senior Accountant"
          />
        </FormField>

        <FormField label="Category code" required>
          <Input
            value={categoryCode}
            onChange={(e) => setCategoryCode(e.target.value)}
            placeholder="e.g. ACCOUNTING"
          />
        </FormField>

        <FormField label="Description" required>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Describe the role, responsibilities, and what you are looking for..."
          />
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Job type" required>
            <Select
              options={JOB_TYPE_OPTIONS}
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
            />
          </FormField>

          <FormField label="Shift" required>
            <Select
              options={SHIFT_OPTIONS}
              value={shift}
              onChange={(e) => setShift(e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Gender preference">
            <Select
              options={GENDER_OPTIONS}
              value={genderPreference}
              onChange={(e) => setGenderPreference(e.target.value)}
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

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={pending || !title.trim() || !categoryCode.trim() || !description.trim()}
          >
            {pending ? 'Saving…' : isNew ? 'Create draft' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
