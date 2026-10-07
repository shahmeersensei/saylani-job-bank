import {
  DEFAULT_COMPANY_DOCUMENT_REQUIREMENTS,
  MASTER_DATA_PARENT,
  type LegalStructure,
  type MasterDataType,
} from '@jobbank/shared';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../client';
import { companyDocumentRequirements, holidays, masterData } from '../schema';
import type { SeedStep } from '../scripts/seed';

/**
 * Pakistan-specific starting lists (M5). Insert-only: an existing (type, code) is left
 * untouched, so a Super Admin's edits survive every later `db:seed`. Safe in production.
 */
interface SeedItem {
  code: string;
  label: string;
  description?: string;
  meta?: Record<string, unknown>;
  /** Code of the parent item (its type comes from MASTER_DATA_PARENT). */
  parent?: string;
}

const reason = (code: string, label: string, requiresNote = false): SeedItem => ({
  code,
  label,
  meta: { requiresNote },
});

const CATEGORY_SKILLS: Record<string, { label: string; skills: [string, string][] }> = {
  RETAIL_SALES: {
    label: 'Retail & Sales',
    skills: [
      ['CUSTOMER_SERVICE', 'Customer service'],
      ['CASH_HANDLING', 'Cash handling'],
      ['SALES', 'Sales & promotion'],
      ['INVENTORY_COUNTING', 'Stock counting & shelving'],
    ],
  },
  HOSPITALITY: {
    label: 'Hospitality & Food Service',
    skills: [
      ['COOKING', 'Cooking'],
      ['FOOD_PREPARATION', 'Food preparation'],
      ['WAITER_SERVICE', 'Waiter service'],
      ['HOUSEKEEPING', 'Housekeeping'],
      ['BARISTA', 'Barista'],
    ],
  },
  DRIVING_DELIVERY: {
    label: 'Driving & Delivery',
    skills: [
      ['LTV_DRIVING', 'Car / LTV driving'],
      ['HTV_DRIVING', 'Truck / HTV driving'],
      ['MOTORCYCLE_DELIVERY', 'Motorcycle delivery'],
      ['ROUTE_NAVIGATION', 'Route navigation (maps apps)'],
    ],
  },
  SECURITY: {
    label: 'Security',
    skills: [
      ['SECURITY_GUARD', 'Security guard duties'],
      ['CCTV_MONITORING', 'CCTV monitoring'],
    ],
  },
  CONSTRUCTION_TRADES: {
    label: 'Construction & Trades',
    skills: [
      ['MASONRY', 'Masonry'],
      ['CARPENTRY', 'Carpentry'],
      ['PLUMBING', 'Plumbing'],
      ['ELECTRICAL_WIRING', 'Electrical wiring'],
      ['WELDING', 'Welding'],
      ['PAINTING', 'Painting'],
      ['TILE_FIXING', 'Tile fixing'],
    ],
  },
  TEXTILE_GARMENTS: {
    label: 'Textile & Garments',
    skills: [
      ['INDUSTRIAL_STITCHING', 'Industrial stitching'],
      ['TAILORING', 'Tailoring'],
      ['EMBROIDERY', 'Embroidery'],
      ['FABRIC_CUTTING', 'Fabric cutting'],
    ],
  },
  MANUFACTURING: {
    label: 'Manufacturing & Factory',
    skills: [
      ['MACHINE_OPERATION', 'Machine operation'],
      ['QUALITY_INSPECTION', 'Quality inspection'],
      ['PACKING', 'Packing'],
    ],
  },
  WAREHOUSE_LOGISTICS: {
    label: 'Warehouse & Logistics',
    skills: [
      ['LOADING_UNLOADING', 'Loading & unloading'],
      ['FORKLIFT_OPERATION', 'Forklift operation'],
      ['STOCK_KEEPING', 'Stock keeping'],
      ['DISPATCH', 'Dispatch'],
    ],
  },
  OFFICE_ADMIN: {
    label: 'Office & Administration',
    skills: [
      ['MS_OFFICE', 'MS Office (Word, Excel)'],
      ['DATA_ENTRY', 'Data entry'],
      ['RECEPTION', 'Reception & front desk'],
      ['URDU_TYPING', 'Urdu typing'],
      ['RECORD_KEEPING', 'Filing & record keeping'],
    ],
  },
  CALL_CENTRE: {
    label: 'Call Centre & Customer Support',
    skills: [
      ['INBOUND_CALLS', 'Inbound calls'],
      ['OUTBOUND_CALLS', 'Outbound / telesales calls'],
      ['CHAT_SUPPORT', 'Chat & email support'],
      ['ENGLISH_COMMUNICATION', 'Spoken English'],
    ],
  },
  IT_SOFTWARE: {
    label: 'IT & Software',
    skills: [
      ['WEB_DEVELOPMENT', 'Web development'],
      ['MOBILE_APP_DEVELOPMENT', 'Mobile app development'],
      ['GRAPHIC_DESIGN', 'Graphic design'],
      ['DIGITAL_MARKETING', 'Digital marketing'],
      ['COMPUTER_HARDWARE', 'Computer hardware repair'],
      ['NETWORKING', 'Networking'],
    ],
  },
  ACCOUNTS_FINANCE: {
    label: 'Accounts & Finance',
    skills: [
      ['BOOKKEEPING', 'Bookkeeping'],
      ['ACCOUNTING_SOFTWARE', 'Accounting software (QuickBooks, Peachtree)'],
      ['BILLING', 'Billing & invoicing'],
      ['PAYROLL', 'Payroll'],
    ],
  },
  HEALTHCARE: {
    label: 'Healthcare',
    skills: [
      ['NURSING_ASSISTANCE', 'Nursing assistance'],
      ['PHARMACY_ASSISTANCE', 'Pharmacy assistance'],
      ['LAB_ASSISTANCE', 'Lab assistance'],
      ['FIRST_AID', 'First aid'],
      ['ELDERLY_CARE', 'Elderly care'],
    ],
  },
  EDUCATION: {
    label: 'Teaching & Education',
    skills: [
      ['PRIMARY_TEACHING', 'Primary teaching'],
      ['TUTORING', 'Tutoring'],
      ['QURAN_TEACHING', 'Quran teaching'],
      ['CHILDCARE', 'Daycare & childcare'],
    ],
  },
  REPAIR_TECHNICIAN: {
    label: 'Repair & Technicians',
    skills: [
      ['AUTO_MECHANIC', 'Auto mechanic'],
      ['MOTORCYCLE_MECHANIC', 'Motorcycle mechanic'],
      ['AUTO_ELECTRICIAN', 'Auto electrician'],
      ['AC_REFRIGERATION', 'AC & refrigeration technician'],
      ['MOBILE_PHONE_REPAIR', 'Mobile phone repair'],
      ['APPLIANCE_REPAIR', 'Home appliance repair'],
    ],
  },
  CLEANING_MAINTENANCE: {
    label: 'Cleaning & Maintenance',
    skills: [
      ['JANITORIAL', 'Janitorial & cleaning'],
      ['OFFICE_ASSISTANT', 'Office assistant / tea service'],
      ['GARDENING', 'Gardening'],
    ],
  },
  BEAUTY_PERSONAL_CARE: {
    label: 'Beauty & Personal Care',
    skills: [
      ['BEAUTICIAN', 'Beautician'],
      ['BARBER', 'Barber'],
      ['MEHNDI_ARTIST', 'Mehndi artist'],
    ],
  },
};

const CITIES: [string, string, string][] = [
  ['KARACHI', 'Karachi', 'SINDH'],
  ['LAHORE', 'Lahore', 'PUNJAB'],
  ['ISLAMABAD', 'Islamabad', 'ISLAMABAD'],
  ['RAWALPINDI', 'Rawalpindi', 'PUNJAB'],
  ['FAISALABAD', 'Faisalabad', 'PUNJAB'],
  ['MULTAN', 'Multan', 'PUNJAB'],
  ['HYDERABAD', 'Hyderabad', 'SINDH'],
  ['GUJRANWALA', 'Gujranwala', 'PUNJAB'],
  ['PESHAWAR', 'Peshawar', 'KHYBER_PAKHTUNKHWA'],
  ['QUETTA', 'Quetta', 'BALOCHISTAN'],
  ['SIALKOT', 'Sialkot', 'PUNJAB'],
  ['SARGODHA', 'Sargodha', 'PUNJAB'],
  ['BAHAWALPUR', 'Bahawalpur', 'PUNJAB'],
  ['SUKKUR', 'Sukkur', 'SINDH'],
  ['LARKANA', 'Larkana', 'SINDH'],
  ['ABBOTTABAD', 'Abbottabad', 'KHYBER_PAKHTUNKHWA'],
  ['MARDAN', 'Mardan', 'KHYBER_PAKHTUNKHWA'],
  ['GUJRAT', 'Gujrat', 'PUNJAB'],
  ['SHEIKHUPURA', 'Sheikhupura', 'PUNJAB'],
  ['RAHIM_YAR_KHAN', 'Rahim Yar Khan', 'PUNJAB'],
  ['MUZAFFARABAD', 'Muzaffarabad', 'AZAD_KASHMIR'],
  ['GILGIT', 'Gilgit', 'GILGIT_BALTISTAN'],
];

const AREAS: Record<string, string[]> = {
  KARACHI: [
    'Gulshan-e-Iqbal',
    'Gulistan-e-Jauhar',
    'North Nazimabad',
    'Nazimabad',
    'Federal B Area',
    'North Karachi',
    'New Karachi',
    'Surjani Town',
    'Orangi Town',
    'Baldia Town',
    'SITE',
    'Liaquatabad',
    'Saddar',
    'Lyari',
    'Clifton',
    'Defence (DHA)',
    'PECHS',
    'Shah Faisal Colony',
    'Malir',
    'Korangi',
    'Landhi',
  ],
  LAHORE: [
    'Johar Town',
    'Model Town',
    'Gulberg',
    'Defence (DHA)',
    'Allama Iqbal Town',
    'Township',
    'Wapda Town',
    'Faisal Town',
    'Garden Town',
    'Shadman',
    'Samanabad',
    'Ichhra',
    'Shahdara',
    'Bahria Town',
    'Cantt',
    'Valencia',
    'Green Town',
    'Walled City',
  ],
};

const areaCode = (label: string) =>
  label
    .replace(/\(.*?\)/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

const IMAGES_PDF = ['application/pdf', 'image/jpeg', 'image/png'];
const doc = (
  code: string,
  label: string,
  appliesTo: 'APPLICANT' | 'COMPANY',
  required: boolean,
  mimeTypes = IMAGES_PDF,
  maxSizeMb = 5,
  multiple = false,
): SeedItem => ({ code, label, meta: { appliesTo, required, mimeTypes, maxSizeMb, multiple } });

export const MASTER_DATA_SEED: Record<MasterDataType, SeedItem[]> = {
  JOB_CATEGORY: Object.entries(CATEGORY_SKILLS).map(([code, { label }]) => ({ code, label })),
  SKILL: Object.entries(CATEGORY_SKILLS).flatMap(([parent, { skills }]) =>
    skills.map(([code, label]) => ({ code, label, parent })),
  ),
  EDUCATION_LEVEL: [
    { code: 'NO_FORMAL', label: 'No formal education', meta: { rank: 0 } },
    { code: 'PRIMARY', label: 'Primary (Grade 5)', meta: { rank: 1 } },
    { code: 'MIDDLE', label: 'Middle (Grade 8)', meta: { rank: 2 } },
    { code: 'MATRIC', label: 'Matric / O-Level', meta: { rank: 3 } },
    { code: 'INTERMEDIATE', label: 'Intermediate / A-Level', meta: { rank: 4 } },
    { code: 'DAE', label: 'Diploma of Associate Engineering (DAE)', meta: { rank: 4 } },
    { code: 'BACHELORS_14', label: "Bachelor's (14 years)", meta: { rank: 5 } },
    { code: 'BACHELORS_16', label: "Bachelor's (16 years) / BS", meta: { rank: 6 } },
    { code: 'MASTERS', label: "Master's / MS / MPhil", meta: { rank: 7 } },
    { code: 'PHD', label: 'PhD', meta: { rank: 8 } },
  ],
  LANGUAGE: [
    { code: 'URDU', label: 'Urdu' },
    { code: 'ENGLISH', label: 'English' },
    { code: 'SINDHI', label: 'Sindhi' },
    { code: 'PUNJABI', label: 'Punjabi' },
    { code: 'PASHTO', label: 'Pashto' },
    { code: 'BALOCHI', label: 'Balochi' },
    { code: 'SARAIKI', label: 'Saraiki' },
    { code: 'ARABIC', label: 'Arabic' },
  ],
  CITY: CITIES.map(([code, label, province]) => ({ code, label, meta: { province } })),
  AREA: Object.entries(AREAS).flatMap(([city, areas]) =>
    areas.map((label) => ({ code: `${city}_${areaCode(label)}`, label, parent: city })),
  ),
  DOCUMENT_TYPE: [
    doc('CNIC_FRONT', 'CNIC (front)', 'APPLICANT', true, ['image/jpeg', 'image/png']),
    doc('CNIC_BACK', 'CNIC (back)', 'APPLICANT', true, ['image/jpeg', 'image/png']),
    doc('CV', 'CV / résumé', 'APPLICANT', false, ['application/pdf']),
    doc('PHOTO', 'Passport-size photo', 'APPLICANT', false, ['image/jpeg', 'image/png'], 2),
    doc('EDUCATION_CERTIFICATE', 'Education certificate', 'APPLICANT', false, IMAGES_PDF, 5, true),
    doc('EXPERIENCE_LETTER', 'Experience letter', 'APPLICANT', false, IMAGES_PDF, 5, true),
    doc('DRIVING_LICENSE', 'Driving licence', 'APPLICANT', false),
    doc('CHARACTER_CERTIFICATE', 'Police character certificate', 'APPLICANT', false),
    doc('AUTHORISED_PERSON_CNIC', 'CNIC of authorised person', 'COMPANY', true),
    doc('NTN_CERTIFICATE', 'NTN certificate', 'COMPANY', false),
    doc('SECP_REGISTRATION', 'SECP incorporation certificate', 'COMPANY', false),
    doc('BUSINESS_REGISTRATION', 'Business registration / chamber certificate', 'COMPANY', false),
    doc('ADDRESS_PROOF', 'Utility bill (address proof)', 'COMPANY', false),
    doc('AUTHORISATION_LETTER', 'Authorisation letter on letterhead', 'COMPANY', false),
  ],
  REJECTION_REASON: [
    reason('SKILLS_MISMATCH', 'Skills do not match the role'),
    reason('INSUFFICIENT_EXPERIENCE', 'Not enough experience'),
    reason('INTERVIEW_PERFORMANCE', 'Did not perform well in the interview'),
    reason('COMMUNICATION', 'Communication below requirement'),
    reason('SALARY_EXPECTATION', 'Salary expectation too high'),
    reason('NO_SHOW', 'Did not attend the interview'),
    reason('POSITION_FILLED', 'Position already filled'),
    reason('DOCUMENTS_INCOMPLETE', 'Documents incomplete'),
    reason('OTHER', 'Other', true),
  ],
  REFUSAL_REASON: [
    reason('SALARY_TOO_LOW', 'Salary too low'),
    reason('COMMUTE_TOO_LONG', 'Commute too long'),
    reason('WORKING_HOURS', 'Working hours or shift not suitable'),
    reason('BETTER_OFFER', 'Accepted another offer'),
    reason('ROLE_MISMATCH', 'Role differs from what was described'),
    reason('WORKPLACE_CONCERNS', 'Concerns about the workplace'),
    reason('PERSONAL_REASONS', 'Personal or family reasons'),
    reason('OTHER', 'Other', true),
  ],
  BLACKLIST_REASON: [
    {
      ...reason('FRAUDULENT_DOCUMENTS', 'Fraudulent documents'),
      meta: { requiresNote: false, appliesTo: ['APPLICANT', 'COMPANY'] },
    },
    {
      ...reason('MISCONDUCT', 'Misconduct or harassment'),
      meta: { requiresNote: true, appliesTo: ['APPLICANT', 'COMPANY'] },
    },
    {
      ...reason('REPEATED_NO_SHOW', 'Repeated interview no-shows'),
      meta: { requiresNote: false, appliesTo: ['APPLICANT'] },
    },
    {
      ...reason('FAKE_JOB_POSTING', 'Fake or misleading job posting'),
      meta: { requiresNote: false, appliesTo: ['COMPANY'] },
    },
    {
      ...reason('UNPAID_WAGES', 'Unpaid or withheld wages'),
      meta: { requiresNote: false, appliesTo: ['COMPANY'] },
    },
    {
      ...reason('EXPLOITATIVE_CONDITIONS', 'Exploitative working conditions'),
      meta: { requiresNote: true, appliesTo: ['COMPANY'] },
    },
    {
      ...reason('DATA_MISUSE', 'Misuse of applicant data'),
      meta: { requiresNote: true, appliesTo: ['COMPANY'] },
    },
    {
      ...reason('OTHER', 'Other'),
      meta: { requiresNote: true, appliesTo: ['APPLICANT', 'COMPANY'] },
    },
  ],
  VERIFICATION_REJECTION_REASON: [
    reason('INVALID_DOCUMENTS', 'Documents invalid or unreadable'),
    reason('UNVERIFIABLE_ADDRESS', 'Business address could not be verified'),
    reason('UNREACHABLE', 'Company contact could not be reached'),
    reason('DUPLICATE_REGISTRATION', 'Company already registered'),
    reason('NOT_A_BUSINESS', 'Not a genuine business'),
    reason('INELIGIBLE_BUSINESS', 'Business type not eligible'),
    reason('OTHER', 'Other', true),
  ],
  WITHDRAWAL_REASON: [
    reason('APPLICANT_UNAVAILABLE', 'Applicant no longer available'),
    reason('APPLICANT_REQUEST', 'Applicant asked to withdraw'),
    reason('JOB_CLOSED', 'Job closed or filled'),
    reason('DUPLICATE_CASE', 'Duplicate match case'),
    reason('RESTRICTION_APPLIED', 'Restriction applied (blacklist)'),
    reason('OTHER', 'Other', true),
  ],
  INDUSTRY: [
    ['TEXTILE_GARMENTS', 'Textiles & garments'],
    ['MANUFACTURING', 'Manufacturing'],
    ['RETAIL', 'Retail & wholesale'],
    ['FOOD_RESTAURANTS', 'Food & restaurants'],
    ['HOSPITALITY', 'Hotels & hospitality'],
    ['CONSTRUCTION', 'Construction & real estate'],
    ['LOGISTICS', 'Transport & logistics'],
    ['HEALTHCARE', 'Healthcare & pharmaceuticals'],
    ['EDUCATION', 'Education & training'],
    ['IT_SOFTWARE', 'IT & software'],
    ['TELECOM', 'Telecommunications'],
    ['BANKING_FINANCE', 'Banking & finance'],
    ['SECURITY_SERVICES', 'Security services'],
    ['FACILITY_SERVICES', 'Cleaning & facility services'],
    ['AUTOMOTIVE', 'Automotive'],
    ['AGRICULTURE', 'Agriculture & livestock'],
    ['ENERGY', 'Energy & utilities'],
    ['MEDIA_ADVERTISING', 'Media & advertising'],
    ['NGO_NONPROFIT', 'NGO & non-profit'],
    ['GOVERNMENT', 'Government & public sector'],
    ['OTHER', 'Other'],
  ].map(([code, label]) => ({ code: code!, label: label! })),
};

/** Required company documents per legal structure (M7); insert-only like the lists above. */
export const COMPANY_DOCUMENT_REQUIREMENT_SEED = Object.entries(
  DEFAULT_COMPANY_DOCUMENT_REQUIREMENTS,
).flatMap(([legalStructure, codes]) =>
  codes.map((documentTypeCode) => ({
    legalStructure: legalStructure as LegalStructure,
    documentTypeCode,
  })),
);

/**
 * Gregorian-date federal holidays only. Islamic holidays (Eid ul Fitr, Eid ul Adha, Ashura,
 * 12 Rabi ul Awal) depend on the moon sighting: add them in Master data → Holidays once the
 * government announces the dates.
 */
const FIXED_HOLIDAYS: [string, string][] = [
  ['02-05', 'Kashmir Solidarity Day'],
  ['03-23', 'Pakistan Day'],
  ['05-01', 'Labour Day'],
  ['05-28', 'Youm-e-Takbeer'],
  ['08-14', 'Independence Day'],
  ['11-09', 'Iqbal Day'],
  ['12-25', 'Quaid-e-Azam Day / Christmas'],
];

export const HOLIDAY_SEED = [2026, 2027].flatMap((year) =>
  FIXED_HOLIDAYS.map(([monthDay, name]) => ({ date: `${year}-${monthDay}`, name })),
);

export const masterDataSeed: SeedStep = {
  name: 'master data, holidays & company document requirements',
  async run(db: Database) {
    await db.transaction(async (tx) => {
      // Parents first (categories before skills, cities before areas).
      const order: MasterDataType[] = [
        'JOB_CATEGORY',
        'CITY',
        ...(Object.keys(MASTER_DATA_SEED) as MasterDataType[]).filter(
          (t) => t !== 'JOB_CATEGORY' && t !== 'CITY',
        ),
      ];
      for (const type of order) {
        const items = MASTER_DATA_SEED[type];
        for (const [index, item] of items.entries()) {
          let parentId: string | null = null;
          if (item.parent) {
            const [parent] = await tx
              .select({ id: masterData.id })
              .from(masterData)
              .where(
                and(
                  eq(masterData.type, MASTER_DATA_PARENT[type]!.type),
                  eq(masterData.code, item.parent),
                ),
              );
            parentId = parent?.id ?? null;
          }
          await tx
            .insert(masterData)
            .values({
              type,
              code: item.code,
              label: item.label,
              description: item.description ?? null,
              meta: item.meta ?? {},
              parentId,
              sortOrder: (index + 1) * 10,
            })
            .onConflictDoNothing({ target: [masterData.type, masterData.code] });
        }
      }
      await tx.insert(holidays).values(HOLIDAY_SEED).onConflictDoNothing({ target: holidays.date });
      await tx
        .insert(companyDocumentRequirements)
        .values(COMPANY_DOCUMENT_REQUIREMENT_SEED)
        .onConflictDoNothing();
    });
  },
};
