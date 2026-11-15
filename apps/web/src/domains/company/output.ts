import 'server-only';
import {
  COMPANY_LOCATION_KINDS,
  COMPANY_SIZE_BANDS,
  COMPANY_STATUSES,
  DOCUMENT_REVIEW_STATUSES,
  LEGAL_STRUCTURES,
  VERIFICATION_STATES,
} from '@jobbank/shared';
import { z } from 'zod';

/**
 * Response contracts for the company routes (PRD rule 3): the handler validates
 * `data` against these before enveloping it, so an unexpected field fails the
 * request instead of leaking, and extra fields are stripped. These schemas must
 * mirror the `CompanyView` / `CompanyOnboarding` interfaces in
 * `repository.ts` / `staff.ts` exactly — if a service starts returning a new
 * field, add it here deliberately instead of letting it leak.
 */

const geoPointSchema = z.object({ lat: z.number(), lng: z.number() });

export const branchContactSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  city: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  isActive: z.boolean(),
});

export const companyLocationViewSchema = z.object({
  id: z.string(),
  kind: z.enum(COMPANY_LOCATION_KINDS),
  label: z.string(),
  addressLine: z.string(),
  cityCode: z.string(),
  areaCode: z.string().nullable(),
  location: geoPointSchema,
});

export const companyDocumentViewSchema = z.object({
  id: z.string(),
  typeCode: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  reviewStatus: z.enum(DOCUMENT_REVIEW_STATUSES),
  reviewNote: z.string().nullable(),
  uploadedAt: z.string().nullable(),
});

export const verificationSummarySchema = z.object({
  id: z.string(),
  round: z.number(),
  state: z.enum(VERIFICATION_STATES),
  assignedVerifierId: z.string().nullable(),
  submittedAt: z.string(),
  clockStartedAt: z.string(),
  slaDueOn: z.string(),
  sla: z.enum(['ON_TRACK', 'DUE_TODAY', 'BREACHED', 'PAUSED', 'DONE']),
  infoRequest: z.string().nullable(),
  infoRequestedAt: z.string().nullable(),
  employerNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
  rejectionReasonCode: z.string().nullable(),
  decisionNote: z.string().nullable(),
});

export const companyViewSchema = z.object({
  id: z.string(),
  status: z.enum(COMPANY_STATUSES),
  branch: branchContactSchema.nullable(),
  details: z.object({
    legalName: z.string(),
    tradeName: z.string().nullable(),
    legalStructure: z.enum(LEGAL_STRUCTURES),
    ntn: z.string().nullable(),
    registrationNo: z.string().nullable(),
    industryCode: z.string(),
    sizeBand: z.enum(COMPANY_SIZE_BANDS),
    website: z.string().nullable(),
    description: z.string().nullable(),
  }),
  contacts: z.array(
    z.object({
      name: z.string(),
      designation: z.string().nullable(),
      phone: z.string(),
      email: z.string().nullable(),
      isPrimary: z.boolean(),
    }),
  ),
  headOffice: companyLocationViewSchema.nullable(),
  sites: z.array(companyLocationViewSchema),
  documents: z.array(companyDocumentViewSchema),
  requiredDocuments: z.array(z.string()),
  optionalDocuments: z.array(z.string()),
  missing: z.array(z.string()),
  verification: verificationSummarySchema.nullable(),
  editable: z.object({
    details: z.boolean(),
    legal: z.boolean(),
    contacts: z.boolean(),
    locations: z.boolean(),
    branch: z.boolean(),
    documents: z.boolean(),
  }),
  verifiedAt: z.string().nullable(),
  registrationVerifiedSignedAt: z.string().nullable(),
  registrationVerifiedSignedBy: z.string().nullable(),
  createdAt: z.string(),
});

/** The field-visit outreach record returned with a staff-onboarded company. */
export const companyOnboardingSchema = z.object({
  onboardedBy: z
    .object({ name: z.string().nullable(), roleLabel: z.string().nullable() })
    .nullable(),
  visitDate: z.string().nullable(),
  notes: z.object({
    headOfficeAddress: z.string().nullable(),
    otherSites: z.string().nullable(),
    workforceRoles: z.string().nullable(),
    workforceType: z.string().nullable(),
    workforceShifts: z.string().nullable(),
    workforceOpenings: z.string().nullable(),
    yearsInBusiness: z.string().nullable(),
    previousHiring: z.string().nullable(),
    certifications: z.string().nullable(),
    additionalNotes: z.string().nullable(),
  }),
});

/** `staffOnboardCompany` returns the company view plus its outreach record. */
export const onboardedCompanySchema = companyViewSchema.extend({
  onboarding: companyOnboardingSchema,
});

/** `markCompanyRegistrationVerifiedSigned` route response envelope. */
export const verifiedSignedCompanyResponseSchema = z.object({
  verifiedSigned: z.literal(true),
  status: z.enum(COMPANY_STATUSES),
  company: companyViewSchema,
});
