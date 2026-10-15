'use client';

import { experienceSchema } from '@jobbank/shared';
import { useState } from 'react';
import { Checkbox, Input, Select, Textarea } from '@/components/atoms';
import { FormField } from '@/components/molecules';
import { MonthYearPicker } from './MonthYearPicker';
import type { ApplicantProfile } from '@/domains/applicant';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import {
  errorMessage,
  toFieldErrors,
  zodFieldErrors,
  type FieldErrors,
} from '../../_components/applicants/form';
import { RepeatableList } from './RepeatableList';
import { blankToNull, useStepSave, type StepProps } from './step';

interface JobRow {
  employerName: string;
  jobTitle: string;
  categoryCode: string;
  startMonth: string;
  endMonth: string;
  isCurrent: boolean;
  description: string;
}

export function ExperienceStep({ profile, lists, bindSave }: StepProps) {
  const [noExperience, setNoExperience] = useState(profile?.hasNoExperience ?? false);
  const [jobs, setJobs] = useState<JobRow[]>(
    profile?.experience.map((e) => ({
      employerName: e.employerName,
      jobTitle: e.jobTitle,
      categoryCode: e.categoryCode ?? '',
      startMonth: e.startMonth,
      endMonth: e.endMonth ?? '',
      isCurrent: e.isCurrent,
      description: e.description ?? '',
    })) ?? [],
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);

  useStepSave(bindSave, async () => {
    setAlert(null);
    const parsed = experienceSchema.safeParse({
      hasNoExperience: noExperience,
      items: noExperience
        ? []
        : jobs.map((j) => ({
            employerName: j.employerName,
            jobTitle: j.jobTitle,
            categoryCode: blankToNull(j.categoryCode),
            startMonth: j.startMonth,
            endMonth: j.isCurrent ? null : blankToNull(j.endMonth),
            isCurrent: j.isCurrent,
            description: blankToNull(j.description),
          })),
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return null;
    }
    setErrors({});
    try {
      const { data } = await apiFetch<ApplicantProfile>('/api/v1/applicants/me/experience', {
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
    <div className="grid gap-5">
      {alert && (
        <p role="alert" className="bg-danger-soft text-danger-soft-fg rounded-lg px-4 py-3 text-sm">
          {alert}
        </p>
      )}
      <Checkbox
        label="I have no work experience yet"
        description="That is fine — many jobs are for freshers."
        checked={noExperience}
        onCheckedChange={(checked) => setNoExperience(checked === true)}
      />
      {!noExperience && (
        <RepeatableList
          items={jobs}
          onChange={setJobs}
          max={15}
          itemLabel={(i) => `Job ${i + 1}`}
          addLabel={jobs.length ? 'Add another job' : 'Add a job'}
          emptyHint="Start with your most recent job. Informal work counts too (e.g. helping at a shop)."
          createItem={() => ({
            employerName: '',
            jobTitle: '',
            categoryCode: '',
            startMonth: '',
            endMonth: '',
            isCurrent: false,
            description: '',
          })}
          renderItem={(row, update, i) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Employer" required error={errors[`items.${i}.employerName`]}>
                <Input
                  value={row.employerName}
                  onChange={(e) => update({ employerName: e.target.value })}
                />
              </FormField>
              <FormField label="Job title" required error={errors[`items.${i}.jobTitle`]}>
                <Input
                  value={row.jobTitle}
                  onChange={(e) => update({ jobTitle: e.target.value })}
                />
              </FormField>
              <FormField label="Kind of work" error={errors[`items.${i}.categoryCode`]}>
                <Select
                  placeholder="Choose a category"
                  value={row.categoryCode}
                  onChange={(e) => update({ categoryCode: e.target.value })}
                  options={lists.categories}
                />
              </FormField>
              <div className="flex items-end pb-2">
                <Checkbox
                  label="I work here now"
                  checked={row.isCurrent}
                  onCheckedChange={(checked) =>
                    update({ isCurrent: checked === true, endMonth: '' })
                  }
                />
              </div>
              <FormField label="Started (month)" required error={errors[`items.${i}.startMonth`]}>
                <MonthYearPicker
                  value={row.startMonth}
                  onChange={(v) => update({ startMonth: v })}
                  maxYear={new Date().getFullYear()}
                />
              </FormField>
              {!row.isCurrent && (
                <FormField label="Ended (month)" required error={errors[`items.${i}.endMonth`]}>
                  <MonthYearPicker
                    value={row.endMonth}
                    onChange={(v) => update({ endMonth: v })}
                    maxYear={new Date().getFullYear()}
                  />
                </FormField>
              )}
              <FormField label="What did you do?" className="sm:col-span-2">
                <Textarea
                  rows={2}
                  value={row.description}
                  onChange={(e) => update({ description: e.target.value })}
                />
              </FormField>
            </div>
          )}
        />
      )}
      {errors.hasNoExperience && (
        <p role="alert" className="text-danger text-sm">
          {errors.hasNoExperience}
        </p>
      )}
    </div>
  );
}
