import type {
  ApplicantStatus,
  Gender,
  JobType,
  LanguageProficiency,
  Shift,
  SkillLevel,
} from '@jobbank/shared';

export interface RegistrationFormData {
  registrationReference: string;
  registeredAt: string;
  registrationSource: string;
  status: ApplicantStatus;
  branchName: string | null;
  registeredByName: string | null;
  personal: {
    fullName: string;
    fatherName: string;
    cnic: string;
    dateOfBirth: string;
    gender: Gender;
    phone: string | null;
    email: string | null;
  };
  address: {
    addressLine: string;
    area: string | null;
    city: string | null;
  } | null;
  education: {
    level: string;
    institution: string | null;
    fieldOfStudy: string | null;
    completionYear: number | null;
    isCurrent: boolean;
    grade: string | null;
  }[];
  experience: {
    employerName: string;
    jobTitle: string;
    category: string | null;
    startMonth: string;
    endMonth: string | null;
    isCurrent: boolean;
    description: string | null;
  }[];
  hasNoExperience: boolean;
  skills: { name: string; level: SkillLevel; years: number }[];
  languages: { name: string; proficiency: LanguageProficiency }[];
  certifications: {
    name: string;
    issuer: string | null;
    issuedMonth: string | null;
    expiresMonth: string | null;
  }[];
  preferences: {
    categories: string[];
    minSalaryPkr: number | null;
    shifts: Shift[];
    jobTypes: JobType[];
    willingRadiusM: number | null;
    availableFrom: string | null;
  } | null;
  verificationQrDataUrl: string;
  /**
   * The applicant's passport photo (PHOTO document) embedded as a data URL,
   * like the verification QR — the printout must be self-contained. Null
   * when no photo is on file or it could not be read.
   */
  photoDataUrl: string | null;
  /**
   * Same-origin download route for the PHOTO document — the same route the
   * profile page views the photo through. The print client uses it when the
   * embedded copy is missing or fails to render. Null when no photo is on file.
   */
  photoUrl: string | null;
  canRegenerate: boolean;
  /**
   * Current passport-size PHOTO document id, or null when the applicant has
   * no usable photo. An id, never a signed URL: view links live only 120
   * seconds, so the client fetches a fresh one when the print page loads
   * and again on print.
   */
  photoDocumentId: string | null;
}

export interface PublicApplicantVerification {
  registrationReference: string;
  registeredAt: string;
  maskedApplicantName: string;
  branchName: string | null;
}
