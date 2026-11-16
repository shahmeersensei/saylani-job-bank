/** Applicant profiles, documents and identity checks (M6). */
import './events';

export {
  confirmMyDocument,
  confirmStaffApplicantPhoto,
  downloadMyDocument,
  downloadStaffApplicantDocument,
  listApplicantDocumentTypes,
  myDocumentLink,
  presignMyDocument,
  presignStaffApplicantPhoto,
  removeMyDocument,
  staffDocumentLink,
  uploadMyDocument,
  uploadStaffApplicantPhoto,
  type DocumentLink,
  type PresignedDocument,
} from './documents';
export { applicantMachine, type ApplicantEvent } from './machine';
export { monthlyApplicantCounts } from './monthlyCounts';
export {
  applicantProfileSchema,
  applicantStaffViewSchema,
  verifiedSignedResponseSchema,
} from './output';
export {
  getMyProfile,
  myBranchOptions,
  registerApplicant,
  saveMyCertifications,
  saveMyEducation,
  saveMyExperience,
  saveMyLanguages,
  saveMyPreferences,
  saveMySkills,
  setMyLocation,
  setMyStatus,
  updateMyPersonal,
} from './profile';
export type { ApplicantDocumentType, ApplicantDocumentView, ApplicantProfile } from './repository';
export {
  cancelApplicantToken,
  completeTokenForRegistration,
  issueApplicantToken,
  lookupApplicantTokens,
  type ApplicantTokenView,
  type IssueApplicantTokenResult,
} from './tokens';
export {
  createApplicantRegistrationForm,
  ensureApplicantVerificationToken,
  getPublicApplicantVerification,
  resolveApplicantVerification,
} from './verification';
export type { PublicApplicantVerification, RegistrationFormData } from './registration-form.types';
export {
  APPLICANT_SORTABLE,
  applicantFilters,
  changeApplicantPhone,
  getApplicantForStaff,
  listApplicants,
  markApplicantRegistrationVerifiedSigned,
  registerApplicantAtCounter,
  requestPhoneChangeCode,
  registerApplicantForStaff,
  staffRegisterApplicant,
  staffUpdateApplicantProfile,
  staffSetApplicantStatus,
  staffUpdateApplicant,
  transferApplicant,
  verifyApplicantIdentity,
  type ApplicantListItem,
  type ApplicantStaffView,
  type IdentityCheckView,
} from './staff';
