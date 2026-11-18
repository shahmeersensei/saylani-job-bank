import 'server-only';
import {
  APPLICANT_DOCUMENT_STATUSES,
  APPLICANT_STATUSES,
  GENDERS,
  IDENTITY_METHODS,
  IDENTITY_OUTCOMES,
  IDENTITY_STATUSES,
  JOB_TYPES,
  LANGUAGE_PROFICIENCIES,
  SHIFTS,
  SKILL_LEVELS,
} from '@jobbank/shared';
import { z } from 'zod';

/**
 * Response contracts for the applicant routes (PRD rule 3): the handler validates
 * `data` against these before enveloping it, so an unexpected field fails the
 * request instead of leaking, and extra fields are stripped. These schemas must
 * mirror the `ApplicantProfile` / `ApplicantStaffView` interfaces in
 * `repository.ts` / `staff.ts` exactly — if a service starts returning a new
 * field, add it here deliberately instead of letting it leak. The CNIC, phone
 * and email in these views are intentional: these routes are staff- or
 * self-only, and the route-level permission is the gate.
 */

const geoPointSchema = z.object({ lat: z.number(), lng: z.number() });

const branchContactSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  city: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  isActive: z.boolean(),
});

/** Must match PROFILE_SECTIONS ids in @jobbank/shared (applicant.ts). */
const profileSectionIdSchema = z.enum([
  'personal',
  'location',
  'skills',
  'education',
  'experience',
  'preferences',
  'documents',
  'languages',
]);

export const applicantDocumentViewSchema = z.object({
  id: z.string(),
  typeCode: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(APPLICANT_DOCUMENT_STATUSES),
  reviewNote: z.string().nullable(),
  uploadedAt: z.string().nullable(),
});

export const applicantProfileSchema = z.object({
  id: z.string(),
  status: z.enum(APPLICANT_STATUSES),
  identityStatus: z.enum(IDENTITY_STATUSES),
  identityNote: z.string().nullable(),
  branch: branchContactSchema.nullable(),
  personal: z.object({
    fullName: z.string(),
    fatherName: z.string(),
    cnic: z.string(),
    dateOfBirth: z.string(),
    gender: z.enum(GENDERS),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  address: z
    .object({
      addressLine: z.string(),
      cityCode: z.string(),
      areaCode: z.string().nullable(),
      // Location is optional at registration, so it can be null in the DB.
      // A strict schema here caused a 500 after the applicant was already saved.
      // Location is optional at registration, so it can be null in the DB.
      // A strict schema here caused a 500 after the applicant was already saved.
      location: geoPointSchema.nullable(),
    })
    .nullable(),
  permanentAddress: z
    .object({
      addressLine: z.string(),
      cityCode: z.string(),
      areaCode: z.string().nullable(),
    })
    .nullable(),
  additionalNotes: z.string().nullable(),
  education: z.array(
    z.object({
      levelCode: z.string(),
      institution: z.string().nullable(),
      fieldOfStudy: z.string().nullable(),
      completionYear: z.number().nullable(),
      isCurrent: z.boolean(),
      grade: z.string().nullable(),
    }),
  ),
  experience: z.array(
    z.object({
      employerName: z.string(),
      jobTitle: z.string(),
      categoryCode: z.string().nullable(),
      startMonth: z.string(),
      endMonth: z.string().nullable(),
      isCurrent: z.boolean(),
      description: z.string().nullable(),
    }),
  ),
  hasNoExperience: z.boolean(),
  skills: z.array(
    z.object({
      skillCode: z.string(),
      level: z.enum(SKILL_LEVELS),
      years: z.number(),
    }),
  ),
  languages: z.array(
    z.object({
      languageCode: z.string(),
      proficiency: z.enum(LANGUAGE_PROFICIENCIES),
    }),
  ),
  certifications: z.array(
    z.object({
      name: z.string(),
      issuer: z.string().nullable(),
      issuedMonth: z.string().nullable(),
      expiresMonth: z.string().nullable(),
    }),
  ),
  preferences: z
    .object({
      categoryCodes: z.array(z.string()),
      minSalaryPkr: z.number().nullable(),
      shifts: z.array(z.enum(SHIFTS)),
      jobTypes: z.array(z.enum(JOB_TYPES)),
      availableFrom: z.string().nullable(),
    })
    .nullable(),
  documents: z.array(applicantDocumentViewSchema),
  completeness: z.object({
    percent: z.number(),
    sections: z.array(
      z.object({
        id: profileSectionIdSchema,
        label: z.string(),
        weight: z.number(),
        done: z.boolean(),
      }),
    ),
    activationMissing: z.array(profileSectionIdSchema),
  }),
  identityLocked: z.boolean(),
  branchLocked: z.boolean(),
  registrationVerifiedSignedAt: z.string().nullable(),
  registrationVerifiedSignedBy: z.string().nullable(),
  activatedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const identityCheckViewSchema = z.object({
  id: z.string(),
  outcome: z.enum(IDENTITY_OUTCOMES),
  method: z.enum(IDENTITY_METHODS),
  notes: z.string().nullable(),
  verifiedByName: z.string().nullable(),
  createdAt: z.string(),
  cnicMatchesCurrent: z.boolean(),
});

/** `markApplicantRegistrationVerifiedSigned` route response envelope. */
export const verifiedSignedResponseSchema = z.object({
  verifiedSigned: z.literal(true),
  verifiedSignedAt: z.string(),
  verifiedSignedBy: z.string(),
});

/** The staff detail view: the full profile plus staff-only fields. */
export const applicantStaffViewSchema = applicantProfileSchema.extend({
  userId: z.string(),
  statusReason: z.string().nullable(),
  createdByStaff: z
    .object({ name: z.string().nullable(), roleLabel: z.string().nullable() })
    .nullable(),
  counterRegistered: z.boolean(),
  identityHistory: z.array(identityCheckViewSchema),
  can: z.object({
    verifyIdentity: z.boolean(),
    manage: z.boolean(),
    transfer: z.boolean(),
    shortlist: z.boolean(),
    scheduleInterview: z.boolean(),
    referToEmployer: z.boolean(),
  }),
});
