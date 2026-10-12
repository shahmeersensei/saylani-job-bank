'use client';

import { certificationsSchema, educationSchema } from '@jobbank/shared';
import { useState } from 'react';
import { Checkbox, Input, Select } from '@/components/atoms';
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
import { blankToNull, numberOrNull, useStepSave, type StepProps } from './step';

interface EducationRow {
  levelCode: string;
  institution: string;
  fieldOfStudy: string;
  completionYear: string;
  isCurrent: boolean;
  grade: string;
}

interface CertificationRow {
  name: string;
  issuer: string;
  issuedMonth: string;
  expiresMonth: string;
}

const prefixed = (errors: FieldErrors, prefix: string): FieldErrors =>
  Object.fromEntries(Object.entries(errors).map(([k, v]) => [`${prefix}.${k}`, v]));

export function EducationStep({ profile, lists, bindSave }: StepProps) {
  const [education, setEducation] = useState<EducationRow[]>(
    profile?.education.map((e) => ({
      levelCode: e.levelCode,
      institution: e.institution ?? '',
      fieldOfStudy: e.fieldOfStudy ?? '',
      completionYear: e.completionYear?.toString() ?? '',
      isCurrent: e.isCurrent,
      grade: e.grade ?? '',
    })) ?? [],
  );
  const [certifications, setCertifications] = useState<CertificationRow[]>(
    profile?.certifications.map((c) => ({
      name: c.name,
      issuer: c.issuer ?? '',
      issuedMonth: c.issuedMonth ?? '',
      expiresMonth: c.expiresMonth ?? '',
    })) ?? [],
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);

  useStepSave(bindSave, async () => {
    setAlert(null);
    const edu = educationSchema.safeParse({
      items: education.map((e) => ({
        levelCode: e.levelCode || undefined,
        institution: blankToNull(e.institution),
        fieldOfStudy: blankToNull(e.fieldOfStudy),
        completionYear: numberOrNull(e.completionYear),
        isCurrent: e.isCurrent,
        grade: blankToNull(e.grade),
      })),
    });
    const certs = certificationsSchema.safeParse({
      items: certifications.map((c) => ({
        name: c.name,
        issuer: blankToNull(c.issuer),
        issuedMonth: blankToNull(c.issuedMonth),
        expiresMonth: blankToNull(c.expiresMonth),
      })),
    });
    if (!edu.success || !certs.success) {
      setErrors({
        ...(edu.success ? {} : prefixed(zodFieldErrors(edu.error), 'education')),
        ...(certs.success ? {} : prefixed(zodFieldErrors(certs.error), 'certifications')),
      });
      return null;
    }
    setErrors({});
    try {
      await apiFetch<ApplicantProfile>('/api/v1/applicants/me/education', {
        method: 'PUT',
        body: edu.data,
      });
      const { data } = await apiFetch<ApplicantProfile>('/api/v1/applicants/me/certifications', {
        method: 'PUT',
        body: certs.data,
      });
      return data;
    } catch (err) {
      if (err instanceof ApiClientError && err.issues.length > 0) {
        setErrors(prefixed(toFieldErrors(err.issues), 'education'));
      } else setAlert(errorMessage(err));
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
      <RepeatableList
        items={education}
        onChange={setEducation}
        max={10}
        itemLabel={(i) => `Education ${i + 1}`}
        addLabel={education.length ? 'Add more education' : 'Add education'}
        emptyHint="Add your highest level of schooling first. If you never went to school, choose “No formal education”."
        createItem={() => ({
          levelCode: '',
          institution: '',
          fieldOfStudy: '',
          completionYear: '',
          isCurrent: false,
          grade: '',
        })}
        renderItem={(row, update, i) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Level" required error={errors[`education.items.${i}.levelCode`]}>
              <Select
                placeholder="Choose a level"
                value={row.levelCode}
                onChange={(e) => update({ levelCode: e.target.value })}
                options={lists.educationLevels}
              />
            </FormField>
            <FormField label="School, college or university">
              <Input
                value={row.institution}
                onChange={(e) => update({ institution: e.target.value })}
              />
            </FormField>
            <FormField label="Subject or field" hint="e.g. Pre-engineering, Commerce">
              <Input
                value={row.fieldOfStudy}
                onChange={(e) => update({ fieldOfStudy: e.target.value })}
              />
            </FormField>
            <FormField
              label={row.isCurrent ? 'Expected completion year' : 'Year completed'}
              error={errors[`education.items.${i}.completionYear`]}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={1950}
                value={row.completionYear}
                onChange={(e) => update({ completionYear: e.target.value })}
              />
            </FormField>
            <FormField label="Grade or marks" hint="Optional, e.g. A or 72%">
              <Input value={row.grade} onChange={(e) => update({ grade: e.target.value })} />
            </FormField>
            <div className="flex items-end pb-2">
              <Checkbox
                label="I am still studying"
                checked={row.isCurrent}
                onCheckedChange={(checked) => update({ isCurrent: checked === true })}
              />
            </div>
          </div>
        )}
      />

      <div className="border-border grid gap-3 border-t pt-5">
        <div className="grid gap-1">
          <h3 className="text-fg text-base font-semibold">Certificates and courses</h3>
          <p className="text-fg-muted text-sm">
            Optional — e.g. a TEVTA electrician course or a driving course.
          </p>
        </div>
        <RepeatableList
          items={certifications}
          onChange={setCertifications}
          max={15}
          itemLabel={(i) => `Certificate ${i + 1}`}
          addLabel="Add a certificate"
          createItem={() => ({ name: '', issuer: '', issuedMonth: '', expiresMonth: '' })}
          renderItem={(row, update, i) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Certificate or course"
                required
                error={errors[`certifications.items.${i}.name`]}
              >
                <Input value={row.name} onChange={(e) => update({ name: e.target.value })} />
              </FormField>
              <FormField label="Issued by">
                <Input value={row.issuer} onChange={(e) => update({ issuer: e.target.value })} />
              </FormField>
              <FormField label="Issued (month)">
                <MonthYearPicker
                  value={row.issuedMonth}
                  onChange={(v) => update({ issuedMonth: v })}
                />
              </FormField>
              <FormField
                label="Expires (month)"
                error={errors[`certifications.items.${i}.expiresMonth`]}
              >
                <MonthYearPicker
                  value={row.expiresMonth}
                  onChange={(v) => update({ expiresMonth: v })}
                  placeholder="Month (optional)"
                />
              </FormField>
            </div>
          )}
        />
      </div>
    </div>
  );
}
