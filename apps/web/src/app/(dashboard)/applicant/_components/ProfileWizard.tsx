'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/components/atoms';
import { toast } from '@/components/molecules';
import { WizardLayout } from '@/components/templates';
import type { ApplicantDocumentType, ApplicantProfile } from '@/domains/applicant';
import type { ProfileLists } from '../../_components/applicants/lists';
import { DocumentsManager } from './DocumentsManager';
import { EducationStep } from './EducationStep';
import { ExperienceStep } from './ExperienceStep';
import { LocationStep } from './LocationStep';
import { PersonalStep } from './PersonalStep';
import { PreferencesStep } from './PreferencesStep';
import { SkillsStep } from './SkillsStep';
import type { StepSave } from './step';
import { WIZARD_STEPS } from './wizard-steps';

export function ProfileWizard({
  initialProfile,
  initialStep,
  lists,
  documentTypes,
  maxRadiusM,
  onReturnToOverview,
  onProfileUpdate,
}: {
  initialProfile: ApplicantProfile | null;
  initialStep: number;
  lists: ProfileLists;
  documentTypes: ApplicantDocumentType[];
  maxRadiusM: number;
  onReturnToOverview?: () => void;
  onProfileUpdate?: (profile: ApplicantProfile) => void;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [current, setCurrent] = useState(initialProfile ? initialStep : 0);
  const [saving, setSaving] = useState(false);
  const saveRef = useRef<StepSave | null>(null);
  const bindSave = (save: StepSave) => {
    saveRef.current = save;
  };
  const step = WIZARD_STEPS[current]!;
  const isLast = current === WIZARD_STEPS.length - 1;

  const go = (index: number) => {
    setCurrent(index);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Saves the current step; true when it is safe to move on. */
  const save = async (): Promise<boolean> => {
    if (step.id === 'documents') return true; // documents save as they upload
    setSaving(true);
    try {
      const saved = await saveRef.current?.();
      if (!saved) return false;
      setProfile(saved);
      onProfileUpdate?.(saved);
      return true;
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    if (!(await save())) return;
    if (isLast) {
      toast.success('Your profile is saved');
      if (onReturnToOverview) {
        onReturnToOverview();
      } else {
        router.push('/applicant');
        router.refresh();
      }
    } else go(current + 1);
  };

  const stepProps = { profile, lists, bindSave };

  return (
    <div>
      {onReturnToOverview && (
        <div className="mb-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft />}
            onClick={onReturnToOverview}
          >
            Back to profile overview
          </Button>
        </div>
      )}
      <WizardLayout
        title={profile ? 'Edit profile' : 'Create your profile'}
        description={
          profile
            ? `${profile.completeness.percent}% complete. Changes are saved when you press Continue.`
            : 'Takes about 10 minutes. You can save and finish later.'
        }
        steps={WIZARD_STEPS.map((s) => ({
          id: s.id,
          label: s.label,
          description: 'description' in s ? s.description : undefined,
        }))}
        current={current}
        onStepClick={profile ? go : undefined}
        onBack={() => go(current - 1)}
        onNext={next}
        saving={saving}
        nextLabel={isLast ? 'Finish' : profile ? 'Save and continue' : 'Continue'}
        secondaryAction={
          onReturnToOverview ? (
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={async () => {
                if (await save()) {
                  onReturnToOverview();
                }
              }}
            >
              Save and view profile
            </Button>
          ) : profile && !isLast ? (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={async () => {
                if (await save()) {
                  router.push('/applicant');
                  router.refresh();
                }
              }}
            >
              Save and finish later
            </Button>
          ) : undefined
        }
      >
        {step.id === 'personal' && <PersonalStep key={profile?.id ?? 'new'} {...stepProps} />}
        {step.id === 'location' && <LocationStep {...stepProps} />}
        {step.id === 'education' && <EducationStep {...stepProps} />}
        {step.id === 'experience' && <ExperienceStep {...stepProps} />}
        {step.id === 'skills' && <SkillsStep {...stepProps} />}
        {step.id === 'preferences' && <PreferencesStep {...stepProps} maxRadiusM={maxRadiusM} />}
        {step.id === 'documents' && profile && (
          <DocumentsManager
            profile={profile}
            types={documentTypes}
            onProfile={(p) => {
              setProfile(p);
              onProfileUpdate?.(p);
            }}
          />
        )}
      </WizardLayout>
    </div>
  );
}
