'use client';

import {
  ASSISTED_REGISTRATION_GENDERS,
  GENDER_LABELS,
  JOB_TYPE_LABELS,
  JOB_TYPES,
  LANGUAGE_PROFICIENCIES,
  LANGUAGE_PROFICIENCY_LABELS,
  SHIFT_LABELS,
  SHIFTS,
  SKILL_LEVEL_LABELS,
  SKILL_LEVELS,
  staffApplicantProfileUpdateSchema,
  staffRegisterApplicantSchema,
  type ApplicantStatus,
  type ApplicantTokenView,
  type Gender,
} from '@jobbank/shared';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Plus,
  Printer,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Button, Checkbox, Input, RadioGroup, Select, Textarea } from '@/components/atoms';
import type { SelectOption } from '@/components/atoms';
import {
  CNICInput,
  DateTimePicker,
  FormField,
  PhoneInput,
  SearchableSelect,
  toast,
} from '@/components/molecules';
import type { ApplicantStaffView, PresignedDocument } from '@/domains/applicant';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { putWithProgress } from '@/lib/upload/put-with-progress';
import { errorMessage, toFieldErrors, type FieldErrors } from './form';
import { PhotoCapture, type CapturedPhoto } from './PhotoCapture';
import {
  FormErrorSummary,
  fieldControlId,
  humanizeFieldKey,
  useFocusFieldErrors,
} from '../FormErrorSummary';
import { APPLICANT_STATUS_PILL } from './labels';

type EducationRow = {
  id: string | null;
  levelCode: string;
  institution: string;
  fieldOfStudy: string;
  completionYear: string;
  isCurrent: boolean;
  grade: string;
};

type ExperienceRow = {
  id: string | null;
  employerName: string;
  jobTitle: string;
  categoryCode: string;
  startMonth: string;
  endMonth: string;
  isCurrent: boolean;
  description: string;
};

type CertificationRow = {
  id: string | null;
  name: string;
  issuer: string;
  issuedMonth: string;
  expiresMonth: string;
};

interface Props {
  branches: SelectOption[];
  cities: SelectOption[];
  areas: SelectOption[];
  educationLevels: SelectOption[];
  skills: SelectOption[];
  languages: SelectOption[];
  categories: SelectOption[];
  basePath: string;
  applicant?: ApplicantStaffView;
  /**
   * Counter 2 token mode (2026-11-13): the first-counter token this
   * registration completes. CNIC, name, phone and branch come prefilled
   * from the token; the CNIC is locked because the server only completes a
   * token whose CNIC matches the registration.
   */
  token?: ApplicantTokenView;
}

/**
 * Redesign 2026-11-16: numbered section heading shared by every card, so
 * staff can tell where they are in the long form at a glance. The number
 * badge is decorative; the heading text stays the accessible name.
 */
function SectionHeading({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3 sm:col-span-2">
      <span
        aria-hidden="true"
        className="bg-primary-soft text-primary-soft-fg flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
      >
        {step}
      </span>
      <div className="grid gap-0.5">
        <h2 className="text-fg text-base font-semibold">{title}</h2>
        {description ? <p className="text-fg-muted text-sm">{description}</p> : null}
      </div>
    </div>
  );
}

export function StaffRegisterApplicantForm({
  branches,
  cities,
  areas,
  educationLevels,
  skills,
  languages,
  categories,
  basePath,
  applicant,
  token,
}: Props) {
  const router = useRouter();
  const editing = Boolean(applicant);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [registered, setRegistered] = useState<{
    id: string;
    fullName: string;
    reference: string;
    branchName: string | null;
    status: ApplicantStatus;
    tokenCode: string | null;
    photoStatus: 'saved' | 'failed' | 'skipped';
  } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  // Live photo capture (2026-11-13): the captured JPEG is held in memory until
  // the applicant exists, then uploaded as the PHOTO document. Registration
  // only — profile editing keeps its photo in the applicant's Documents page.
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [photoSkipped, setPhotoSkipped] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const { requestErrorFocus, requestAlertFocus } = useFocusFieldErrors(errors, formRef, alert);
  const [education, setEducation] = useState<EducationRow[]>(
    () =>
      applicant?.education.map((item, index) => ({
        id: applicant.recordIds.education[index] ?? null,
        levelCode: item.levelCode,
        institution: item.institution ?? '',
        fieldOfStudy: item.fieldOfStudy ?? '',
        completionYear: item.completionYear?.toString() ?? '',
        isCurrent: item.isCurrent,
        grade: item.grade ?? '',
      })) ?? [],
  );
  const [experience, setExperience] = useState<ExperienceRow[]>(
    () =>
      applicant?.experience.map((item, index) => ({
        id: applicant.recordIds.experience[index] ?? null,
        employerName: item.employerName,
        jobTitle: item.jobTitle,
        categoryCode: item.categoryCode ?? '',
        startMonth: item.startMonth,
        endMonth: item.endMonth ?? '',
        isCurrent: item.isCurrent,
        description: item.description ?? '',
      })) ?? [],
  );
  const [hasNoExperience, setHasNoExperience] = useState(applicant?.hasNoExperience ?? false);
  const [skillsList, setSkillsList] = useState<
    { skillCode: string; level: string; years: string }[]
  >(
    () =>
      applicant?.skills.map((item) => ({
        skillCode: item.skillCode,
        level: item.level,
        years: item.years.toString(),
      })) ?? [],
  );
  const [languagesList, setLanguagesList] = useState<
    { languageCode: string; proficiency: string }[]
  >(
    () =>
      applicant?.languages.map((item) => ({
        languageCode: item.languageCode,
        proficiency: item.proficiency,
      })) ?? [],
  );
  const [certifications, setCertifications] = useState<CertificationRow[]>(
    () =>
      applicant?.certifications.map((item, index) => ({
        id: applicant.recordIds.certifications[index] ?? null,
        name: item.name,
        issuer: item.issuer ?? '',
        issuedMonth: item.issuedMonth ?? '',
        expiresMonth: item.expiresMonth ?? '',
      })) ?? [],
  );
  const [preferences, setPreferences] = useState<{
    categoryCodes: string[];
    minSalaryPkr: string;
    shifts: string[];
    jobTypes: string[];
    availableFrom: string;
  }>({
    categoryCodes: applicant?.preferences?.categoryCodes ?? [],
    minSalaryPkr: applicant?.preferences?.minSalaryPkr?.toString() ?? '',
    shifts: applicant?.preferences?.shifts ?? [],
    jobTypes: applicant?.preferences?.jobTypes ?? [],
    availableFrom: applicant?.preferences?.availableFrom ?? '',
  });
  const [form, setForm] = useState({
    branchId: token?.branchId ?? applicant?.branch?.id ?? branches[0]?.value ?? '',
    fullName: token?.applicantName ?? applicant?.personal.fullName ?? '',
    fatherName: applicant?.personal.fatherName ?? '',
    cnic: token?.cnic ?? applicant?.personal.cnic ?? '',
    dateOfBirth: applicant?.personal.dateOfBirth ?? '',
    gender: applicant?.personal.gender ?? ('' as Gender | ''),
    phone: token?.phone ?? applicant?.personal.phone ?? '',
    email: applicant?.personal.email ?? '',
    addressLine: applicant?.address?.addressLine ?? '',
    cityCode: applicant?.address?.cityCode ?? '',
    areaCode: applicant?.address?.areaCode ?? '',
    // Home location removed 2026-11-16: the staff form no longer collects
    // a map pin, so there is no lat/lng state any more. The server stores
    // null for new registrations and keeps a stored pin on profile edits.
  });

  const set = (changes: Partial<typeof form>) => setForm((current) => ({ ...current, ...changes }));
  const setPreferredCategory = (index: number, value: string) =>
    setPreferences((current) => {
      const categoryCodes = [...current.categoryCodes];
      if (value) categoryCodes[index] = value;
      else categoryCodes.splice(index, 1);
      return { ...current, categoryCodes };
    });

  const parse = () => {
    const raw = {
      branchId: form.branchId,
      // Token mode: the registration names the first-counter token, and the
      // server completes it (ISSUED → COMPLETED) in the same transaction.
      ...(token ? { tokenId: token.id } : {}),
      fullName: form.fullName,
      fatherName: form.fatherName,
      cnic: form.cnic,
      dateOfBirth: form.dateOfBirth,
      gender: form.gender,
      phone: form.phone,
      email: form.email,
      address: {
        addressLine: form.addressLine,
        cityCode: form.cityCode,
        areaCode: form.areaCode || null,
        branchId: form.branchId,
        // No home location any more (2026-11-16): the field is gone, so
        // the form sends null and the server stores / preserves accordingly.
        location: null,
      },
      education: {
        items: education.map((item) => ({
          levelCode: item.levelCode,
          institution: item.institution || null,
          fieldOfStudy: item.fieldOfStudy || null,
          completionYear: item.completionYear ? Number(item.completionYear) : null,
          isCurrent: item.isCurrent,
          grade: item.grade || null,
        })),
      },
      experience: {
        hasNoExperience,
        items: hasNoExperience
          ? []
          : experience.map((item) => ({
              employerName: item.employerName,
              jobTitle: item.jobTitle,
              categoryCode: item.categoryCode || null,
              startMonth: item.startMonth,
              endMonth: item.isCurrent ? null : item.endMonth || null,
              isCurrent: item.isCurrent,
              description: item.description || null,
            })),
      },
      skills: { items: skillsList.map((item) => ({ ...item, years: Number(item.years) })) },
      languages: { items: languagesList },
      certifications: {
        items: certifications.map((item) => ({
          name: item.name,
          issuer: item.issuer || null,
          issuedMonth: item.issuedMonth || null,
          expiresMonth: item.expiresMonth || null,
        })),
      },
      preferences: preferences.categoryCodes.length
        ? {
            ...preferences,
            minSalaryPkr: preferences.minSalaryPkr ? Number(preferences.minSalaryPkr) : null,
            // Merge (2026-11-10): willingRadiusM was dropped by HEAD migration 0036.
            willingRadiusM: null,
            availableFrom: preferences.availableFrom || null,
          }
        : applicant
          ? null
          : undefined,
    };
    const parsed = applicant
      ? staffApplicantProfileUpdateSchema.safeParse({
          ...raw,
          recordIds: {
            education: education.map((item) => item.id),
            experience: hasNoExperience ? [] : experience.map((item) => item.id),
            certifications: certifications.map((item) => item.id),
          },
        })
      : staffRegisterApplicantSchema.safeParse(raw);
    if (!parsed.success) {
      setErrors(
        toFieldErrors(
          parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        ),
      );
      // Audit 2026-11-11 (H-08): a failed review left the user wherever
      // they were with no pointer to the first bad field. Jump there.
      requestErrorFocus();
      return null;
    }
    setErrors({});
    return parsed.data;
  };

  /**
   * Photo upload after the applicant exists: presign → PUT to the app's upload
   * route → confirm, through the staff photo endpoints. Never throws: a failed photo
   * must not undo a completed registration — the success screen says so and
   * staff retry from the applicant's Documents page.
   */
  const uploadPhoto = async (
    applicantId: string,
    captured: CapturedPhoto,
  ): Promise<'saved' | 'failed'> => {
    try {
      const contentType = captured.blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const { data: presigned } = await apiFetch<PresignedDocument>(
        `/api/v1/applicants/${applicantId}/documents`,
        {
          method: 'POST',
          body: {
            typeCode: 'PHOTO',
            fileName: contentType === 'image/png' ? 'passport-photo.png' : 'passport-photo.jpg',
            contentType,
            sizeBytes: captured.blob.size,
          },
        },
      );
      await putWithProgress({
        url: presigned.upload.url,
        file: captured.blob,
        headers: presigned.upload.headers,
      });
      await apiFetch(
        `/api/v1/applicants/${applicantId}/documents/${presigned.documentId}/confirm`,
        { method: 'POST' },
      );
      return 'saved';
    } catch {
      return 'failed';
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = parse();
    if (!payload) {
      setReview(false);
      return;
    }
    setSaving(true);
    setAlert(null);
    try {
      if (applicant) {
        await apiFetch(`/api/v1/applicants/${applicant.id}/profile`, {
          method: 'PATCH',
          body: payload,
        });
        toast.success('Applicant profile updated');
        router.push(`${basePath}/${applicant.id}`);
        router.refresh();
        return;
      }

      const { data } = await apiFetch<{
        id: string;
        personal: { fullName: string };
        registrationReference: string;
        branch: { name: string } | null;
        status: ApplicantStatus;
      }>('/api/v1/applicants', {
        method: 'POST',
        body: payload,
        idempotencyKey: crypto.randomUUID(),
      });
      setRegistered({
        id: data.id,
        fullName: data.personal.fullName,
        reference: data.registrationReference,
        branchName: data.branch?.name ?? null,
        status: data.status,
        tokenCode: token?.tokenCode ?? null,
        photoStatus: photo ? await uploadPhoto(data.id, photo) : 'skipped',
      });
    } catch (error) {
      if (error instanceof ApiClientError && error.issues.length > 0) {
        setErrors(toFieldErrors(error.issues));
        requestErrorFocus();
      } else {
        setErrors({});
        setAlert(errorMessage(error));
        requestAlertFocus();
      }
      setReview(false);
    } finally {
      setSaving(false);
    }
  };

  const branchName =
    applicant?.branch?.name ??
    branches.find((branch) => branch.value === form.branchId)?.label ??
    'Not assigned';
  const selectedCity = cities.find((city) => city.value === form.cityCode)?.label;
  const selectedArea = areas.find((area) => area.value === form.areaCode)?.label;

  if (registered) {
    return (
      <section
        className="border-border bg-surface shadow-card grid gap-5 rounded-xl border p-6"
        role="status"
      >
        <div
          aria-hidden="true"
          className="bg-success-soft text-success-soft-fg flex h-12 w-12 items-center justify-center rounded-full"
        >
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <div className="grid gap-2">
          <h2 className="text-fg text-xl font-semibold">Job seeker registered successfully</h2>
          <p className="text-fg-muted text-sm">{registered.fullName}</p>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-fg-muted">Registration reference</dt>
            <dd className="text-fg font-medium">{registered.reference}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Assigned branch</dt>
            <dd className="text-fg font-medium">{registered.branchName ?? 'Not assigned'}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Registration status</dt>
            <dd className="text-fg font-medium">
              {APPLICANT_STATUS_PILL[registered.status].label}
            </dd>
          </div>
          {registered.tokenCode && (
            <div>
              <dt className="text-fg-muted">Token</dt>
              <dd className="text-fg font-medium">{registered.tokenCode} · completed</dd>
            </div>
          )}
          <div>
            <dt className="text-fg-muted">Photo</dt>
            <dd className="text-fg font-medium">
              {registered.photoStatus === 'saved'
                ? 'Passport photo saved'
                : registered.photoStatus === 'failed'
                  ? 'Photo could not be saved — upload it from the applicant’s Documents'
                  : 'No photo captured'}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button asChild leftIcon={<Printer />}>
            <Link href={`/print/applicants/${registered.id}/registration`}>
              Print Job Seeker Form
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={`${basePath}/${registered.id}`}>View Applicant</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form className="grid gap-6" onSubmit={submit} noValidate ref={formRef}>
      {alert && (
        <p role="alert" className="bg-danger-soft text-danger-soft-fg rounded-lg px-4 py-3 text-sm">
          {alert}
        </p>
      )}
      <FormErrorSummary errors={errors} labelFor={humanizeFieldKey} />
      {!review ? (
        <>
          {/* Redesign 2026-11-16: the old "Branch assignment" card held a
              single field. It is now a header strip — title, branch/token
              chips, the branch picker when it applies, and a step nav so
              staff can jump between the six sections of this long form. */}
          <section
            className="border-border bg-surface shadow-card grid gap-4 rounded-xl border p-5"
            aria-label="Registration summary"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="bg-primary-soft text-primary-soft-fg flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                >
                  <UserPlus className="h-5 w-5" />
                </span>
                <div className="grid gap-0.5">
                  <h2 className="text-fg text-base font-semibold">
                    {editing
                      ? (applicant?.personal.fullName ?? 'Edit job seeker profile')
                      : 'Applicant registration'}
                  </h2>
                  <p className="text-fg-muted text-sm">
                    {editing
                      ? 'Update the applicant’s details below. Fields marked * are required.'
                      : 'Complete the form on the applicant’s behalf. Fields marked * are required.'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="bg-surface-muted text-fg-muted rounded-full px-3 py-1 text-xs font-medium">
                  {branchName}
                </span>
                {token ? (
                  <span className="bg-primary-soft text-primary-soft-fg rounded-full px-3 py-1 text-xs font-medium">
                    Token {token.tokenCode}
                  </span>
                ) : null}
              </div>
            </div>
            {applicant ? (
              <p className="text-fg-muted text-sm">
                Assigned branch: {branchName}. Profile editing does not change branch assignment.
              </p>
            ) : token ? (
              <p className="text-fg-muted text-sm">
                Assigned branch: {branchName}. The token was issued at this branch; the registration
                stays at this branch.
              </p>
            ) : (
              <FormField
                label="Destination branch"
                required
                error={errors.branchId}
                id={fieldControlId('branchId')}
              >
                <Select
                  value={form.branchId}
                  onChange={(event) => set({ branchId: event.target.value })}
                  options={branches}
                  placeholder="Choose a branch"
                />
              </FormField>
            )}
            <nav
              aria-label="Form sections"
              className="border-border flex flex-wrap gap-2 border-t pt-4"
            >
              {[
                { id: 'personal', step: 1, label: 'Personal' },
                { id: 'contact', step: 2, label: 'Contact & address' },
                { id: 'education', step: 3, label: 'Education' },
                { id: 'experience', step: 4, label: 'Experience' },
                { id: 'skills', step: 5, label: 'Skills' },
                { id: 'languages', step: 6, label: 'Languages' },
                { id: 'certificates', step: 7, label: 'Certificates' },
                { id: 'preferences', step: 8, label: 'Job preferences' },
              ].map((item) => (
                <a
                  key={item.id}
                  href={`#section-${item.id}`}
                  className="border-border text-fg-muted hover:border-primary hover:text-fg flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
                >
                  <span
                    aria-hidden="true"
                    className="bg-primary-soft text-primary-soft-fg flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold"
                  >
                    {item.step}
                  </span>
                  {item.label}
                </a>
              ))}
            </nav>
          </section>
          {/* Photo in its own right-hand column: previously it sat in the
              header row, so the whole row was ~260px tall and the fields
              started below it, leaving a large empty void under the heading.
              Fields now flow in the left column beside the photo; on mobile
              the photo stays first in the DOM, so it still shows on top. */}
          <section
            id="section-personal"
            className="border-border bg-surface shadow-card grid scroll-mt-24 items-start gap-4 rounded-xl border p-5 sm:grid-cols-[minmax(0,1fr)_148px]"
          >
            {!editing && (
              <div className="sm:col-start-2 sm:row-start-1 sm:justify-self-end">
                <PhotoCapture
                  photo={photo}
                  onPhotoChange={(next) => {
                    setPhoto(next);
                    if (next) setPhotoError(null);
                  }}
                  skipped={photoSkipped}
                  onSkippedChange={(next) => {
                    setPhotoSkipped(next);
                    if (next) setPhotoError(null);
                  }}
                  validationError={photoError}
                  disabled={saving}
                />
              </div>
            )}
            <div
              className={
                editing
                  ? 'grid content-start gap-4 sm:col-span-2 sm:grid-cols-2'
                  : 'grid content-start gap-4 sm:col-start-1 sm:row-start-1 sm:grid-cols-2'
              }
            >
              <SectionHeading
                step={1}
                title="Personal information"
                description="Name, CNIC, date of birth and photo — checked against the CNIC card."
              />
              <FormField
                label="Full name"
                required
                error={errors.fullName}
                id={fieldControlId('fullName')}
                className="sm:col-span-2"
              >
                <Input
                  value={form.fullName}
                  onChange={(event) => set({ fullName: event.target.value })}
                />
              </FormField>
              <FormField
                label="Father's or husband's name"
                required
                error={errors.fatherName}
                id={fieldControlId('fatherName')}
                className="sm:col-span-2"
              >
                <Input
                  value={form.fatherName}
                  onChange={(event) => set({ fatherName: event.target.value })}
                />
              </FormField>
              <FormField
                label="CNIC"
                required
                error={errors.cnic}
                id={fieldControlId('cnic')}
                hint={
                  token
                    ? 'From the token, locked. If the CNIC is wrong, cancel this token and issue a new one at Counter 1.'
                    : undefined
                }
              >
                <CNICInput
                  value={form.cnic}
                  onChange={(value) => set({ cnic: value.digits })}
                  disabled={Boolean(token)}
                />
              </FormField>
              <FormField
                label="Date of birth"
                required
                error={errors.dateOfBirth}
                id={fieldControlId('dateOfBirth')}
              >
                <DateTimePicker
                  mode="date"
                  value={form.dateOfBirth}
                  onChange={(iso) => set({ dateOfBirth: iso })}
                />
              </FormField>
              <FormField
                label="Gender"
                required
                error={errors.gender}
                id={fieldControlId('gender')}
                hint={
                  form.gender === 'UNDISCLOSED'
                    ? 'Gender is currently unspecified. Choose an option to change it, or leave it unchanged.'
                    : undefined
                }
                className="sm:col-span-2"
              >
                <RadioGroup
                  aria-label="Gender"
                  orientation="horizontal"
                  value={form.gender}
                  onValueChange={(value) => set({ gender: value as Gender })}
                  options={ASSISTED_REGISTRATION_GENDERS.map((gender) => ({
                    value: gender,
                    label: GENDER_LABELS[gender],
                  }))}
                />
              </FormField>
            </div>
          </section>
          {/* Redesign 2026-11-16: contact and address were two near-empty
              cards. They are one card now, split by a divider, so the form
              reads as six sections instead of seven. */}
          <section
            id="section-contact"
            className="border-border bg-surface shadow-card grid scroll-mt-24 gap-4 rounded-xl border p-5 sm:grid-cols-2"
          >
            <SectionHeading
              step={2}
              title="Contact & address"
              description="How to reach the applicant, and where they live."
            />
            <FormField
              label="Mobile number"
              required
              error={errors.phone}
              id={fieldControlId('phone')}
              hint={
                applicant
                  ? 'Sign-in mobile is not changed here. Use the separate Change mobile action when account recovery is required.'
                  : 'The administrator has confirmed this number. The applicant will verify it with OTP on first login.'
              }
              className="sm:col-span-2"
            >
              {applicant ? (
                <Input value={form.phone} disabled />
              ) : (
                <PhoneInput
                  value={form.phone}
                  onChange={(value) => set({ phone: value.e164 ?? '' })}
                />
              )}
            </FormField>
            <FormField
              label="Email"
              error={errors.email}
              id={fieldControlId('email')}
              hint={
                applicant
                  ? 'This updates the contact email on the profile only; sign-in credentials are unchanged.'
                  : undefined
              }
            >
              <Input
                type="email"
                placeholder="Email (Optional)"
                value={form.email}
                onChange={(event) => set({ email: event.target.value })}
              />
            </FormField>
            <div className="border-border grid gap-4 border-t pt-4 sm:col-span-2 sm:grid-cols-2">
              <h3 className="text-fg text-sm font-semibold sm:col-span-2">Residential address</h3>
              <FormField
                label="Address"
                required
                error={errors['address.addressLine']}
                id={fieldControlId('address.addressLine')}
                className="sm:col-span-2"
              >
                <Input
                  value={form.addressLine}
                  onChange={(event) => set({ addressLine: event.target.value })}
                />
              </FormField>
              <FormField
                label="City"
                required
                error={errors['address.cityCode']}
                id={fieldControlId('address.cityCode')}
              >
                <Select
                  value={form.cityCode}
                  onChange={(event) => set({ cityCode: event.target.value })}
                  options={cities}
                  placeholder="Choose a city"
                />
              </FormField>
              <FormField
                label="Area"
                error={errors['address.areaCode']}
                id={fieldControlId('address.areaCode')}
              >
                <SearchableSelect
                  value={form.areaCode}
                  onChange={(areaCode) => set({ areaCode })}
                  options={areas}
                  placeholder="Type to search an area"
                />
              </FormField>
            </div>
          </section>
          <section
            id="section-education"
            className="border-border bg-surface shadow-card grid scroll-mt-24 gap-4 rounded-xl border p-5"
          >
            <SectionHeading
              step={3}
              title="Education"
              description="Add schooling, college, university, or vocational education."
            />
            {education.map((item, index) => (
              <div
                key={index}
                className="border-border bg-surface-muted grid gap-4 rounded-xl border p-4 sm:grid-cols-2"
              >
                <h3 className="text-fg text-sm font-semibold sm:col-span-2">
                  Education {index + 1}
                </h3>
                <FormField
                  label="Education level"
                  required
                  id={fieldControlId(`education.items.${index}.levelCode`)}
                  error={errors[`education.items.${index}.levelCode`]}
                >
                  <Select
                    value={item.levelCode}
                    options={educationLevels}
                    placeholder="Choose a level"
                    onChange={(event) =>
                      setEducation((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, levelCode: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </FormField>
                <FormField
                  label="Institution"
                  id={fieldControlId(`education.items.${index}.institution`)}
                  error={errors[`education.items.${index}.institution`]}
                >
                  <Input
                    value={item.institution}
                    onChange={(event) =>
                      setEducation((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, institution: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </FormField>
                <FormField
                  label="Field of study"
                  id={fieldControlId(`education.items.${index}.fieldOfStudy`)}
                  error={errors[`education.items.${index}.fieldOfStudy`]}
                >
                  <Input
                    value={item.fieldOfStudy}
                    onChange={(event) =>
                      setEducation((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, fieldOfStudy: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </FormField>
                <FormField
                  label="Completion year"
                  id={fieldControlId(`education.items.${index}.completionYear`)}
                  error={errors[`education.items.${index}.completionYear`]}
                >
                  <Input
                    type="number"
                    value={item.completionYear}
                    onChange={(event) =>
                      setEducation((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, completionYear: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </FormField>
                <FormField
                  label="Grade or marks"
                  id={fieldControlId(`education.items.${index}.grade`)}
                  error={errors[`education.items.${index}.grade`]}
                >
                  <Input
                    value={item.grade}
                    onChange={(event) =>
                      setEducation((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, grade: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </FormField>
                <div className="flex items-end justify-between">
                  <Checkbox
                    label="Still studying"
                    checked={item.isCurrent}
                    onCheckedChange={(checked) =>
                      setEducation((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, isCurrent: checked === true } : row,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    leftIcon={<Trash2 />}
                    onClick={() => setEducation((rows) => rows.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              leftIcon={<Plus />}
              onClick={() =>
                setEducation((rows) => [
                  ...rows,
                  {
                    id: null,
                    levelCode: '',
                    institution: '',
                    fieldOfStudy: '',
                    completionYear: '',
                    isCurrent: false,
                    grade: '',
                  },
                ])
              }
            >
              Add education
            </Button>
          </section>
          <section
            id="section-experience"
            className="border-border bg-surface shadow-card grid scroll-mt-24 gap-4 rounded-xl border p-5"
          >
            <SectionHeading
              step={4}
              title="Work experience"
              description="Informal and formal work experience can be included."
            />
            <Checkbox
              label="No work experience yet"
              checked={hasNoExperience}
              onCheckedChange={(checked) => setHasNoExperience(checked === true)}
            />
            {!hasNoExperience &&
              experience.map((item, index) => (
                <div
                  key={index}
                  className="border-border bg-surface-muted grid gap-4 rounded-xl border p-4 sm:grid-cols-2"
                >
                  <h3 className="text-fg text-sm font-semibold sm:col-span-2">
                    Experience {index + 1}
                  </h3>
                  <FormField
                    label="Employer"
                    required
                    id={fieldControlId(`experience.items.${index}.employerName`)}
                    error={errors[`experience.items.${index}.employerName`]}
                  >
                    <Input
                      value={item.employerName}
                      onChange={(event) =>
                        setExperience((rows) =>
                          rows.map((row, i) =>
                            i === index ? { ...row, employerName: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <FormField
                    label="Job title"
                    required
                    id={fieldControlId(`experience.items.${index}.jobTitle`)}
                    error={errors[`experience.items.${index}.jobTitle`]}
                  >
                    <Input
                      value={item.jobTitle}
                      onChange={(event) =>
                        setExperience((rows) =>
                          rows.map((row, i) =>
                            i === index ? { ...row, jobTitle: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <FormField
                    label="Kind of work"
                    id={fieldControlId(`experience.items.${index}.categoryCode`)}
                    error={errors[`experience.items.${index}.categoryCode`]}
                  >
                    <Select
                      value={item.categoryCode}
                      options={categories}
                      placeholder="Choose a category"
                      onChange={(event) =>
                        setExperience((rows) =>
                          rows.map((row, i) =>
                            i === index ? { ...row, categoryCode: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <FormField
                    label="Started"
                    required
                    id={fieldControlId(`experience.items.${index}.startMonth`)}
                    error={errors[`experience.items.${index}.startMonth`]}
                  >
                    <Input
                      type="month"
                      value={item.startMonth}
                      onChange={(event) =>
                        setExperience((rows) =>
                          rows.map((row, i) =>
                            i === index ? { ...row, startMonth: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </FormField>
                  {!item.isCurrent && (
                    <FormField
                      label="Ended"
                      required
                      id={fieldControlId(`experience.items.${index}.endMonth`)}
                      error={errors[`experience.items.${index}.endMonth`]}
                    >
                      <Input
                        type="month"
                        value={item.endMonth}
                        onChange={(event) =>
                          setExperience((rows) =>
                            rows.map((row, i) =>
                              i === index ? { ...row, endMonth: event.target.value } : row,
                            ),
                          )
                        }
                      />
                    </FormField>
                  )}
                  <FormField
                    label="What did they do?"
                    className="sm:col-span-2"
                    id={fieldControlId(`experience.items.${index}.description`)}
                    error={errors[`experience.items.${index}.description`]}
                  >
                    <Textarea
                      rows={2}
                      value={item.description}
                      onChange={(event) =>
                        setExperience((rows) =>
                          rows.map((row, i) =>
                            i === index ? { ...row, description: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <div className="flex items-center justify-between sm:col-span-2">
                    <Checkbox
                      label="Currently working here"
                      checked={item.isCurrent}
                      onCheckedChange={(checked) =>
                        setExperience((rows) =>
                          rows.map((row, i) =>
                            i === index
                              ? { ...row, isCurrent: checked === true, endMonth: '' }
                              : row,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      leftIcon={<Trash2 />}
                      onClick={() => setExperience((rows) => rows.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            {!hasNoExperience && (
              <Button
                type="button"
                variant="secondary"
                leftIcon={<Plus />}
                onClick={() =>
                  setExperience((rows) => [
                    ...rows,
                    {
                      id: null,
                      employerName: '',
                      jobTitle: '',
                      categoryCode: '',
                      startMonth: '',
                      endMonth: '',
                      isCurrent: false,
                      description: '',
                    },
                  ])
                }
              >
                Add work experience
              </Button>
            )}
          </section>
          {/* Split 2026-11-16: skills and languages were one card; each
              gets its own section now, so staff see them separately. */}
          <section
            id="section-skills"
            className="border-border bg-surface shadow-card grid scroll-mt-24 gap-4 rounded-xl border p-5"
          >
            <SectionHeading step={5} title="Skills" description="What the applicant can do." />
            {skillsList.map((item, index) => (
              <div
                key={index}
                className="border-border bg-surface-muted grid gap-4 rounded-xl border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
              >
                {/* Fiverr-style search bar: staff type the skill, the list
                    narrows to matches, and picking one stores its code.
                    Free text is never stored — same as the Area field. */}
                <SearchableSelect
                  value={item.skillCode}
                  options={skills}
                  placeholder="Search for a skill…"
                  startAdornment={<Search aria-hidden="true" />}
                  onChange={(skillCode) =>
                    setSkillsList((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, skillCode } : row)),
                    )
                  }
                />
                <Select
                  value={item.level}
                  options={SKILL_LEVELS.map((level) => ({
                    value: level,
                    label: SKILL_LEVEL_LABELS[level],
                  }))}
                  placeholder="Level"
                  onChange={(event) =>
                    setSkillsList((rows) =>
                      rows.map((row, i) =>
                        i === index ? { ...row, level: event.target.value } : row,
                      ),
                    )
                  }
                />
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={item.years}
                  placeholder="Years"
                  onChange={(event) =>
                    setSkillsList((rows) =>
                      rows.map((row, i) =>
                        i === index ? { ...row, years: event.target.value } : row,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={<Trash2 />}
                  onClick={() => setSkillsList((rows) => rows.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              leftIcon={<Plus />}
              onClick={() =>
                setSkillsList((rows) => [...rows, { skillCode: '', level: '', years: '0' }])
              }
            >
              Add skill
            </Button>
          </section>
          <section
            id="section-languages"
            className="border-border bg-surface shadow-card grid scroll-mt-24 gap-4 rounded-xl border p-5"
          >
            <SectionHeading step={6} title="Languages" description="Which languages they speak." />
            {languagesList.map((item, index) => (
              <div
                key={index}
                className="border-border bg-surface-muted grid gap-4 rounded-xl border p-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <Select
                  value={item.languageCode}
                  options={languages}
                  placeholder="Choose a language"
                  onChange={(event) =>
                    setLanguagesList((rows) =>
                      rows.map((row, i) =>
                        i === index ? { ...row, languageCode: event.target.value } : row,
                      ),
                    )
                  }
                />
                <Select
                  value={item.proficiency}
                  options={LANGUAGE_PROFICIENCIES.map((level) => ({
                    value: level,
                    label: LANGUAGE_PROFICIENCY_LABELS[level],
                  }))}
                  placeholder="Proficiency"
                  onChange={(event) =>
                    setLanguagesList((rows) =>
                      rows.map((row, i) =>
                        i === index ? { ...row, proficiency: event.target.value } : row,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={<Trash2 />}
                  onClick={() => setLanguagesList((rows) => rows.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              leftIcon={<Plus />}
              onClick={() =>
                setLanguagesList((rows) => [...rows, { languageCode: '', proficiency: '' }])
              }
            >
              Add language
            </Button>
          </section>
          {/* Split 2026-11-16: certificates and job preferences were one
              card; each gets its own section now. */}
          <section
            id="section-certificates"
            className="border-border bg-surface shadow-card grid scroll-mt-24 gap-4 rounded-xl border p-5"
          >
            <SectionHeading step={7} title="Certificates" description="Courses and certificates." />
            <div className="grid gap-4">
              {certifications.map((item, index) => (
                <div key={index} className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="Certificate or course"
                    required
                    id={fieldControlId(`certifications.items.${index}.name`)}
                    error={errors[`certifications.items.${index}.name`]}
                  >
                    <Input
                      value={item.name}
                      onChange={(event) =>
                        setCertifications((rows) =>
                          rows.map((row, i) =>
                            i === index ? { ...row, name: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <FormField
                    label="Issued by"
                    id={fieldControlId(`certifications.items.${index}.issuer`)}
                    error={errors[`certifications.items.${index}.issuer`]}
                  >
                    <Input
                      value={item.issuer}
                      onChange={(event) =>
                        setCertifications((rows) =>
                          rows.map((row, i) =>
                            i === index ? { ...row, issuer: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <FormField
                    label="Issued month"
                    id={fieldControlId(`certifications.items.${index}.issuedMonth`)}
                    error={errors[`certifications.items.${index}.issuedMonth`]}
                  >
                    <Input
                      type="month"
                      value={item.issuedMonth}
                      onChange={(event) =>
                        setCertifications((rows) =>
                          rows.map((row, i) =>
                            i === index ? { ...row, issuedMonth: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <div className="flex items-end justify-between">
                    <FormField
                      label="Expires month"
                      id={fieldControlId(`certifications.items.${index}.expiresMonth`)}
                      error={errors[`certifications.items.${index}.expiresMonth`]}
                    >
                      <Input
                        type="month"
                        value={item.expiresMonth}
                        onChange={(event) =>
                          setCertifications((rows) =>
                            rows.map((row, i) =>
                              i === index ? { ...row, expiresMonth: event.target.value } : row,
                            ),
                          )
                        }
                      />
                    </FormField>
                    <Button
                      type="button"
                      variant="ghost"
                      leftIcon={<Trash2 />}
                      onClick={() =>
                        setCertifications((rows) => rows.filter((_, i) => i !== index))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                leftIcon={<Plus />}
                onClick={() =>
                  setCertifications((rows) => [
                    ...rows,
                    { id: null, name: '', issuer: '', issuedMonth: '', expiresMonth: '' },
                  ])
                }
              >
                Add certificate
              </Button>
            </div>
          </section>
          <section
            id="section-preferences"
            className="border-border bg-surface shadow-card grid scroll-mt-24 gap-4 rounded-xl border p-5"
          >
            <SectionHeading
              step={8}
              title="Job preferences"
              description="The kind of work the applicant wants."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {applicant ? (
                <div className="grid gap-3">
                  {preferences.categoryCodes.map((categoryCode, index) => (
                    <div key={`${categoryCode}-${index}`} className="flex items-end gap-2">
                      <FormField
                        label={`Preferred job category ${index + 1}`}
                        className="flex-1"
                        id={fieldControlId(`preferences.categoryCodes.${index}`)}
                        error={
                          errors[`preferences.categoryCodes.${index}`] ??
                          errors['preferences.categoryCodes']
                        }
                      >
                        <Select
                          value={categoryCode}
                          options={categories.filter(
                            (option) =>
                              option.value === categoryCode ||
                              !preferences.categoryCodes.includes(option.value),
                          )}
                          placeholder="Choose a category"
                          onChange={(event) => setPreferredCategory(index, event.target.value)}
                        />
                      </FormField>
                      <Button
                        type="button"
                        variant="ghost"
                        leftIcon={<Trash2 />}
                        onClick={() =>
                          setPreferences((current) => ({
                            ...current,
                            categoryCodes: current.categoryCodes.filter((_, i) => i !== index),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  {preferences.categoryCodes.length < 10 && (
                    <Button
                      type="button"
                      variant="secondary"
                      leftIcon={<Plus />}
                      onClick={() =>
                        setPreferences((current) => ({
                          ...current,
                          categoryCodes: [...current.categoryCodes, ''],
                        }))
                      }
                    >
                      Add preferred job category
                    </Button>
                  )}
                </div>
              ) : (
                <FormField
                  label="Preferred job category"
                  id={fieldControlId('preferences.categoryCodes')}
                  error={errors['preferences.categoryCodes']}
                >
                  <Select
                    value={preferences.categoryCodes[0] ?? ''}
                    options={categories}
                    placeholder="Choose a category"
                    onChange={(event) =>
                      setPreferences((current) => ({
                        ...current,
                        categoryCodes: event.target.value ? [event.target.value] : [],
                      }))
                    }
                  />
                </FormField>
              )}
              <FormField
                label="Minimum monthly salary (PKR)"
                id={fieldControlId('preferences.minSalaryPkr')}
                error={errors['preferences.minSalaryPkr']}
              >
                <Input
                  type="number"
                  value={preferences.minSalaryPkr}
                  onChange={(event) =>
                    setPreferences((current) => ({ ...current, minSalaryPkr: event.target.value }))
                  }
                />
              </FormField>
              <FormField
                label="Available from"
                id={fieldControlId('preferences.availableFrom')}
                error={errors['preferences.availableFrom']}
              >
                <DateTimePicker
                  mode="date"
                  value={preferences.availableFrom}
                  onChange={(iso) =>
                    setPreferences((current) => ({ ...current, availableFrom: iso }))
                  }
                />
              </FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <fieldset>
                <legend className="text-fg mb-2 text-sm font-medium">Shifts</legend>
                {SHIFTS.map((shift) => (
                  <Checkbox
                    key={shift}
                    label={SHIFT_LABELS[shift]}
                    checked={preferences.shifts.includes(shift)}
                    onCheckedChange={(checked) =>
                      setPreferences((current) => ({
                        ...current,
                        shifts:
                          checked === true
                            ? [...current.shifts, shift]
                            : current.shifts.filter((value) => value !== shift),
                      }))
                    }
                  />
                ))}
              </fieldset>
              <fieldset>
                <legend className="text-fg mb-2 text-sm font-medium">Job types</legend>
                {JOB_TYPES.map((jobType) => (
                  <Checkbox
                    key={jobType}
                    label={JOB_TYPE_LABELS[jobType]}
                    checked={preferences.jobTypes.includes(jobType)}
                    onCheckedChange={(checked) =>
                      setPreferences((current) => ({
                        ...current,
                        jobTypes:
                          checked === true
                            ? [...current.jobTypes, jobType]
                            : current.jobTypes.filter((value) => value !== jobType),
                      }))
                    }
                  />
                ))}
              </fieldset>
            </div>
          </section>
          {/* Redesign 2026-11-16: the Review button used to sit at the very
              bottom of a long form. It now lives in a sticky bar, so staff
              can review without scrolling back up — this is the only button
              with this name, so existing tests still find exactly one. */}
          <div className="border-border bg-surface shadow-card sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
            <p className="text-fg-muted text-sm">
              {editing
                ? 'Check the details, then review the update.'
                : photo
                  ? 'Photo captured — review the registration when ready.'
                  : photoSkipped
                    ? 'Continuing without a photo — review the registration when ready.'
                    : 'Capture a photo, upload one, or continue without one, then review.'}
            </p>
            <Button
              type="button"
              onClick={() => {
                if (!editing && !photo && !photoSkipped) {
                  setPhotoError(
                    'Capture the applicant’s photo, upload one, or continue without a photo.',
                  );
                  return;
                }
                setPhotoError(null);
                if (parse()) setReview(true);
              }}
              rightIcon={<Check />}
            >
              {editing ? 'Review profile update' : 'Review registration'}
            </Button>
          </div>
        </>
      ) : (
        <section className="border-border bg-surface shadow-card grid gap-4 rounded-xl border p-5">
          <h2 className="text-fg text-base font-semibold">
            {editing ? 'Review profile update' : 'Review registration'}
          </h2>
          <p className="text-fg-muted text-sm">
            Check everything below before {editing ? 'updating the profile' : 'registering'}.
          </p>
          <div className="grid gap-5">
            <div className="grid gap-2">
              <h3 className="text-fg text-sm font-semibold">Personal & contact</h3>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-fg-muted">Name</dt>
                  <dd>{form.fullName}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">CNIC</dt>
                  <dd>{form.cnic}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Mobile</dt>
                  <dd>{form.phone}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Email</dt>
                  <dd>{form.email || 'Not provided'}</dd>
                </div>
              </dl>
            </div>
            <div className="border-border grid gap-2 border-t pt-4">
              <h3 className="text-fg text-sm font-semibold">Branch, photo & address</h3>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-fg-muted">Branch</dt>
                  <dd>{branchName}</dd>
                </div>
                {!editing && (
                  <div>
                    <dt className="text-fg-muted">Photo</dt>
                    <dd>
                      {photo ? (
                        <span className="flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.previewUrl}
                            alt="Applicant photo preview"
                            className="h-[90px] w-[70px] rounded border object-cover"
                          />
                          Passport photo captured
                        </span>
                      ) : photoSkipped ? (
                        'No photo — continued without one'
                      ) : (
                        'No photo'
                      )}
                    </dd>
                  </div>
                )}
                {token && (
                  <div>
                    <dt className="text-fg-muted">Token</dt>
                    <dd>{token.tokenCode}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-fg-muted">Location</dt>
                  <dd>{[selectedArea, selectedCity].filter(Boolean).join(', ')}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-fg-muted">Address</dt>
                  <dd>{form.addressLine}</dd>
                </div>
              </dl>
            </div>
          </div>
          <p className="bg-info-soft text-info-soft-fg rounded-lg px-4 py-3 text-sm">
            {applicant
              ? 'Profile editing does not change sign-in credentials, linked accounts, or first-login OTP verification.'
              : 'No OTP is sent during this registration. The applicant must verify this mobile number when they first sign in.'}
          </p>
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                leftIcon={<ArrowLeft />}
                onClick={() => setReview(false)}
                disabled={saving}
              >
                Edit details
              </Button>
              {applicant && (
                <Button asChild variant="ghost" disabled={saving}>
                  <Link href={`${basePath}/${applicant.id}`}>Cancel</Link>
                </Button>
              )}
            </div>
            <Button type="submit" loading={saving} leftIcon={applicant ? <Check /> : <UserPlus />}>
              {applicant ? 'Update Profile' : 'Register job seeker'}
            </Button>
          </div>
        </section>
      )}
    </form>
  );
}
