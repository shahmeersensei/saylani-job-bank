import { getMyProfile, listApplicantDocumentTypes } from '@/domains/applicant';
import { requireRole } from '@/domains/auth';
import { resolveMatchRadius } from '@/domains/settings';
import { profileLabels, profileLists } from '../../_components/applicants/lists';
import { ApplicantProfileManager } from '../_components/ApplicantProfileManager';
import { WIZARD_STEPS } from '../_components/wizard-steps';

export const metadata = { title: 'My profile — Saylani Job Bank' };

export default async function ApplicantProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; edit?: string }>;
}) {
  const { actor } = await requireRole('APPLICANT');
  const [profile, lists, labels, documentTypes, params] = await Promise.all([
    getMyProfile(actor),
    profileLists(actor),
    profileLabels(),
    listApplicantDocumentTypes(),
    searchParams,
  ]);
  const radius = await resolveMatchRadius({ branchId: profile?.branch?.id ?? null });

  const hasSpecificStep = Boolean(params.step);
  const isEditingParam = params.edit === 'true';
  const initiallyEditing = hasSpecificStep || isEditingParam;

  const stepIndex = Math.max(
    0,
    WIZARD_STEPS.findIndex((s) => s.id === params.step),
  );

  return (
    <ApplicantProfileManager
      initialProfile={profile}
      initialStepIndex={stepIndex}
      initiallyEditing={initiallyEditing}
      lists={lists}
      labels={labels}
      documentTypes={documentTypes}
      maxRadiusM={radius.maxM}
    />
  );
}
