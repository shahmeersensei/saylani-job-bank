import { z } from 'zod';

/**
 * Reference lists managed by Super Admin (M5). Other tables store the `code` (never the
 * label), so codes are permanent and items are deactivated rather than deleted.
 */
export const MASTER_DATA_TYPES = [
  'JOB_CATEGORY',
  'SKILL',
  'EDUCATION_LEVEL',
  'LANGUAGE',
  'CITY',
  'AREA',
  'DOCUMENT_TYPE',
  'REJECTION_REASON',
  'REFUSAL_REASON',
  'BLACKLIST_REASON',
  'VERIFICATION_REJECTION_REASON',
  'WITHDRAWAL_REASON',
  'INDUSTRY',
] as const;

export type MasterDataType = (typeof MASTER_DATA_TYPES)[number];

export const MASTER_DATA_TYPE_LABELS: Record<MasterDataType, string> = {
  JOB_CATEGORY: 'Job categories',
  SKILL: 'Skills',
  EDUCATION_LEVEL: 'Education levels',
  LANGUAGE: 'Languages',
  CITY: 'Cities',
  AREA: 'Areas',
  DOCUMENT_TYPE: 'Document types',
  REJECTION_REASON: 'Employer rejection reasons',
  REFUSAL_REASON: 'Applicant refusal reasons',
  BLACKLIST_REASON: 'Blacklist reasons',
  VERIFICATION_REJECTION_REASON: 'Company verification rejection reasons',
  WITHDRAWAL_REASON: 'Match withdrawal reasons',
  INDUSTRY: 'Industries',
};

/** Which type an item's parent must be, and whether a parent is required. */
export const MASTER_DATA_PARENT: Partial<
  Record<MasterDataType, { type: MasterDataType; required: boolean }>
> = {
  SKILL: { type: 'JOB_CATEGORY', required: false },
  AREA: { type: 'CITY', required: true },
};

export const MASTER_DATA_CODE_PATTERN = /^[A-Z0-9]+(_[A-Z0-9]+)*$/;

export const masterDataCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(48)
  .regex(MASTER_DATA_CODE_PATTERN, 'Use capital letters, digits and underscores, e.g. CNIC_FRONT');

/** "Mobile phone repair" → "MOBILE_PHONE_REPAIR" (a suggestion; the admin can edit it). */
export function suggestMasterDataCode(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

export const PROVINCES = [
  'SINDH',
  'PUNJAB',
  'KHYBER_PAKHTUNKHWA',
  'BALOCHISTAN',
  'ISLAMABAD',
  'GILGIT_BALTISTAN',
  'AZAD_KASHMIR',
] as const;

export const PROVINCE_LABELS: Record<(typeof PROVINCES)[number], string> = {
  SINDH: 'Sindh',
  PUNJAB: 'Punjab',
  KHYBER_PAKHTUNKHWA: 'Khyber Pakhtunkhwa',
  BALOCHISTAN: 'Balochistan',
  ISLAMABAD: 'Islamabad Capital Territory',
  GILGIT_BALTISTAN: 'Gilgit-Baltistan',
  AZAD_KASHMIR: 'Azad Jammu & Kashmir',
};

export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

const reasonMeta = z.strictObject({
  /** The person choosing this reason must also write a note (e.g. "Other"). */
  requiresNote: z.boolean().default(false),
});

/** Shape of `meta` per type. Strict, so typos are rejected instead of silently stored. */
export const MASTER_DATA_META = {
  JOB_CATEGORY: z.strictObject({}),
  SKILL: z.strictObject({}),
  EDUCATION_LEVEL: z.strictObject({
    /** Ordinal used for "minimum education" matching: higher = more education. */
    rank: z.number().int().min(0).max(20),
  }),
  LANGUAGE: z.strictObject({}),
  CITY: z.strictObject({ province: z.enum(PROVINCES) }),
  AREA: z.strictObject({}),
  DOCUMENT_TYPE: z.strictObject({
    appliesTo: z.enum(['APPLICANT', 'COMPANY']),
    required: z.boolean(),
    mimeTypes: z.array(z.enum(DOCUMENT_MIME_TYPES)).min(1),
    maxSizeMb: z.number().int().min(1).max(20),
    /** Several files of this type may be kept (certificates); otherwise a new upload replaces. */
    multiple: z.boolean().default(false),
  }),
  REJECTION_REASON: reasonMeta,
  REFUSAL_REASON: reasonMeta,
  BLACKLIST_REASON: reasonMeta.extend({
    appliesTo: z.array(z.enum(['APPLICANT', 'COMPANY'])).min(1),
  }),
  VERIFICATION_REJECTION_REASON: reasonMeta,
  WITHDRAWAL_REASON: reasonMeta,
  INDUSTRY: z.strictObject({}),
} as const satisfies Record<MasterDataType, z.ZodType>;

export type MasterDataMeta<T extends MasterDataType> = z.infer<(typeof MASTER_DATA_META)[T]>;

export const masterDataTypeSchema = z.enum(MASTER_DATA_TYPES);

export interface MasterDataItem {
  id: string;
  type: MasterDataType;
  code: string;
  label: string;
  description: string | null;
  parentId: string | null;
  meta: Record<string, unknown>;
  sortOrder: number;
  isActive: boolean;
}

export interface Holiday {
  id: string;
  /** ISO date, YYYY-MM-DD (Pakistan time). */
  date: string;
  name: string;
  isActive: boolean;
}
