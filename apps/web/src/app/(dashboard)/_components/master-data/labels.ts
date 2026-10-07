import { PROVINCE_LABELS, type MasterDataItem, type MasterDataType } from '@jobbank/shared';

export const TYPE_SINGULAR: Record<MasterDataType, string> = {
  JOB_CATEGORY: 'job category',
  SKILL: 'skill',
  EDUCATION_LEVEL: 'education level',
  LANGUAGE: 'language',
  CITY: 'city',
  AREA: 'area',
  DOCUMENT_TYPE: 'document type',
  REJECTION_REASON: 'rejection reason',
  REFUSAL_REASON: 'refusal reason',
  BLACKLIST_REASON: 'blacklist reason',
  VERIFICATION_REJECTION_REASON: 'verification rejection reason',
  WITHDRAWAL_REASON: 'withdrawal reason',
  INDUSTRY: 'industry',
};

/** Groups for the type navigation. */
export const TYPE_GROUPS: { title: string; types: MasterDataType[] }[] = [
  { title: 'Jobs & skills', types: ['JOB_CATEGORY', 'SKILL', 'EDUCATION_LEVEL', 'LANGUAGE'] },
  { title: 'Places & documents', types: ['CITY', 'AREA', 'DOCUMENT_TYPE'] },
  { title: 'Companies', types: ['INDUSTRY'] },
  {
    title: 'Reason codes',
    types: [
      'REJECTION_REASON',
      'REFUSAL_REASON',
      'VERIFICATION_REJECTION_REASON',
      'WITHDRAWAL_REASON',
      'BLACKLIST_REASON',
    ],
  },
];

export const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
};

const REASON_TYPES: readonly MasterDataType[] = [
  'REJECTION_REASON',
  'REFUSAL_REASON',
  'BLACKLIST_REASON',
  'VERIFICATION_REJECTION_REASON',
  'WITHDRAWAL_REASON',
];

export const isReasonType = (type: MasterDataType) => REASON_TYPES.includes(type);

const subjects = (list: unknown) =>
  Array.isArray(list)
    ? list.map((s) => (s === 'APPLICANT' ? 'Applicants' : 'Companies')).join(', ')
    : '';

/** One-line summary of an item's type-specific settings, for the table. */
export function metaSummary(item: MasterDataItem): string | null {
  const m = item.meta;
  switch (item.type) {
    case 'EDUCATION_LEVEL':
      return `Rank ${String(m.rank)}`;
    case 'CITY':
      return PROVINCE_LABELS[m.province as keyof typeof PROVINCE_LABELS] ?? null;
    case 'DOCUMENT_TYPE': {
      const types = Array.isArray(m.mimeTypes)
        ? m.mimeTypes.map((t) => MIME_LABELS[t as string] ?? t).join('/')
        : '';
      return [
        m.appliesTo === 'COMPANY' ? 'Companies' : 'Applicants',
        // Company requirements depend on the business type (Settings → Company documents).
        m.appliesTo === 'COMPANY'
          ? 'required per business type'
          : m.required
            ? 'required'
            : 'optional',
        `${types} ≤ ${String(m.maxSizeMb)} MB`,
      ].join(' · ');
    }
    case 'BLACKLIST_REASON':
      return [subjects(m.appliesTo), m.requiresNote ? 'note required' : null]
        .filter(Boolean)
        .join(' · ');
    default:
      return isReasonType(item.type) && m.requiresNote ? 'Note required' : null;
  }
}
