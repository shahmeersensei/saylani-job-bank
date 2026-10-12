'use client';

import {
  LANGUAGE_PROFICIENCIES,
  LANGUAGE_PROFICIENCY_LABELS,
  languagesSchema,
  SKILL_LEVEL_LABELS,
  SKILL_LEVELS,
  skillsSchema,
  type LanguageProficiency,
  type SkillLevel,
} from '@jobbank/shared';
import { useState } from 'react';
import { Input, Select } from '@/components/atoms';
import { FormField } from '@/components/molecules';
import { Plus, X } from 'lucide-react';
import type { ApplicantProfile } from '@/domains/applicant';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import {
  errorMessage,
  toFieldErrors,
  zodFieldErrors,
  type FieldErrors,
} from '../../_components/applicants/form';
import { RepeatableList } from './RepeatableList';
import { useStepSave, type StepProps } from './step';

interface SkillRow {
  skillCode: string; // UPPER_SNAKE derived from user input
  label: string; // display text
  level: SkillLevel | '';
}
interface LanguageRow {
  languageCode: string;
  proficiency: LanguageProficiency | '';
}

const prefixed = (errors: FieldErrors, prefix: string): FieldErrors =>
  Object.fromEntries(Object.entries(errors).map(([k, v]) => [`${prefix}.${k}`, v]));

export function SkillsStep({ profile, lists, bindSave }: StepProps) {
  const [skills, setSkills] = useState<SkillRow[]>(
    profile?.skills.map((s) => ({
      skillCode: s.skillCode,
      label: s.skillCode.replace(/_/g, ' '),
      level: s.level,
    })) ?? [],
  );
  const [skillInput, setSkillInput] = useState('');
  const [pickLevel, setPickLevel] = useState<SkillLevel>('BEGINNER');
  const [languages, setLanguages] = useState<LanguageRow[]>(
    profile?.languages.length ? profile.languages : [{ languageCode: 'URDU', proficiency: '' }],
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);

  useStepSave(bindSave, async () => {
    setAlert(null);
    const s = skillsSchema.safeParse({
      items: skills.map((r) => ({
        skillCode: r.skillCode || undefined,
        level: r.level || undefined,
      })),
    });
    const l = languagesSchema.safeParse({
      items: languages.map((r) => ({
        languageCode: r.languageCode || undefined,
        proficiency: r.proficiency || undefined,
      })),
    });
    if (!s.success || !l.success) {
      setErrors({
        ...(s.success ? {} : prefixed(zodFieldErrors(s.error), 'skills')),
        ...(l.success ? {} : prefixed(zodFieldErrors(l.error), 'languages')),
      });
      return null;
    }
    setErrors({});
    try {
      await apiFetch('/api/v1/applicants/me/skills', { method: 'PUT', body: s.data });
      const { data } = await apiFetch<ApplicantProfile>('/api/v1/applicants/me/languages', {
        method: 'PUT',
        body: l.data,
      });
      return data;
    } catch (err) {
      if (err instanceof ApiClientError && err.issues.length > 0) {
        setErrors(prefixed(toFieldErrors(err.issues), 'skills'));
      } else setAlert(errorMessage(err));
      return null;
    }
  });

  const chosenCodes = new Set(skills.map((s) => s.skillCode));
  const chosenLanguages = new Set(languages.map((l) => l.languageCode));

  const labelToCode = (text: string) =>
    text
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

  const addSkill = () => {
    const trimmed = skillInput.trim();
    if (!trimmed) return;
    const code = labelToCode(trimmed);
    if (!code || chosenCodes.has(code)) return;
    setSkills((prev) => [...prev, { skillCode: code, label: trimmed, level: pickLevel }]);
    setSkillInput('');
    setPickLevel('BEGINNER');
  };

  return (
    <div className="grid gap-6">
      {alert && (
        <p role="alert" className="bg-danger-soft text-danger-soft-fg rounded-lg px-4 py-3 text-sm">
          {alert}
        </p>
      )}
      <div className="grid gap-3">
        <div className="grid gap-1">
          <h3 className="text-fg text-base font-semibold">Skills</h3>
          <p className="text-fg-muted text-sm">
            Jobs are matched on these. Add everything you can do, even without a certificate.
          </p>
        </div>
        {errors['skills.items'] && (
          <p role="alert" className="text-danger text-sm">
            {errors['skills.items']}
          </p>
        )}

        {/* Add row */}
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Skill name" className="min-w-[180px] flex-1">
            <Input
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSkill();
                }
              }}
              placeholder="e.g. MS Excel, AutoCAD, Driving…"
            />
          </FormField>
          <FormField label="Level" className="min-w-[150px]">
            <Select
              value={pickLevel}
              onChange={(e) => setPickLevel(e.target.value as SkillLevel)}
              options={SKILL_LEVELS.map((l) => ({ value: l, label: SKILL_LEVEL_LABELS[l] }))}
            />
          </FormField>
          <button
            type="button"
            onClick={addSkill}
            disabled={!skillInput.trim()}
            className="bg-surface border-border text-fg mb-0.5 flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium disabled:opacity-40"
          >
            <Plus className="size-4" /> Add
          </button>
        </div>

        {/* Skill chips */}
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {skills.map((s, i) => (
              <div
                key={s.skillCode}
                className="bg-surface border-border flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
              >
                <span className="text-fg font-medium">{s.label}</span>
                <span className="text-fg-muted">·</span>
                <select
                  value={s.level}
                  onChange={(e) =>
                    setSkills((prev) =>
                      prev.map((r, j) =>
                        j === i ? { ...r, level: e.target.value as SkillLevel } : r,
                      ),
                    )
                  }
                  className="text-fg-muted bg-transparent text-xs focus:outline-none"
                >
                  {SKILL_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {SKILL_LEVEL_LABELS[l]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setSkills((prev) => prev.filter((_, j) => j !== i))}
                  className="text-fg-subtle hover:text-danger ml-1 transition-colors"
                  aria-label={`Remove ${s.label}`}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-border grid gap-3 border-t pt-5">
        <h3 className="text-fg text-base font-semibold">Languages</h3>
        <RepeatableList
          items={languages}
          onChange={setLanguages}
          max={10}
          itemLabel={(i) => `Language ${i + 1}`}
          addLabel="Add a language"
          createItem={(): LanguageRow => ({ languageCode: '', proficiency: '' })}
          renderItem={(row, update, i) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Language"
                required
                error={errors[`languages.items.${i}.languageCode`]}
              >
                <Select
                  placeholder="Choose a language"
                  value={row.languageCode}
                  onChange={(e) => update({ languageCode: e.target.value })}
                  options={lists.languages.filter(
                    (o) => o.value === row.languageCode || !chosenLanguages.has(o.value),
                  )}
                />
              </FormField>
              <FormField
                label="How well?"
                required
                error={errors[`languages.items.${i}.proficiency`]}
              >
                <Select
                  placeholder="Choose"
                  value={row.proficiency}
                  onChange={(e) => update({ proficiency: e.target.value as LanguageProficiency })}
                  options={LANGUAGE_PROFICIENCIES.map((p) => ({
                    value: p,
                    label: LANGUAGE_PROFICIENCY_LABELS[p],
                  }))}
                />
              </FormField>
            </div>
          )}
        />
      </div>
    </div>
  );
}
