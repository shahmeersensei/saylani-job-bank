'use client';

import { useState } from 'react';
import type { ApplicantDocumentType, ApplicantProfile } from '@/domains/applicant';
import type { ProfileLabels, ProfileLists } from '../../_components/applicants/lists';
import { ApplicantProfileView } from './ApplicantProfileView';
import { ProfileWizard } from './ProfileWizard';
import { WIZARD_STEPS, type WizardStepId } from './wizard-steps';

export interface ApplicantProfileManagerProps {
  initialProfile: ApplicantProfile | null;
  initialStepIndex: number;
  initiallyEditing: boolean;
  lists: ProfileLists;
  labels: ProfileLabels;
  documentTypes: ApplicantDocumentType[];
  maxRadiusM: number;
}

export function ApplicantProfileManager({
  initialProfile,
  initialStepIndex,
  initiallyEditing,
  lists,
  labels,
  documentTypes,
  maxRadiusM,
}: ApplicantProfileManagerProps) {
  const [profile, setProfile] = useState<ApplicantProfile | null>(initialProfile);
  // If the applicant has no profile yet, they must start in wizard mode.
  // If they have a profile, show the unified LinkedIn overview by default unless ?edit=true or ?step= is present.
  const [isEditing, setIsEditing] = useState<boolean>(!initialProfile || initiallyEditing);
  const [stepIndex, setStepIndex] = useState<number>(initialStepIndex);

  const handleEditSection = (stepId: WizardStepId) => {
    const idx = WIZARD_STEPS.findIndex((s) => s.id === stepId);
    setStepIndex(Math.max(0, idx));
    setIsEditing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleReturnToOverview = () => {
    setIsEditing(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!isEditing && profile) {
    return (
      <ApplicantProfileView
        profile={profile}
        labels={labels}
        lists={lists}
        documentTypes={documentTypes}
        onEditSection={handleEditSection}
      />
    );
  }

  return (
    <ProfileWizard
      initialProfile={profile}
      initialStep={stepIndex}
      lists={lists}
      documentTypes={documentTypes}
      maxRadiusM={maxRadiusM}
      onReturnToOverview={profile ? handleReturnToOverview : undefined}
      onProfileUpdate={setProfile}
    />
  );
}
