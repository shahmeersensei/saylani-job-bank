'use client';

import { GENDER_LABELS, JOB_TYPE_LABELS, SHIFT_LABELS, SKILL_LEVEL_LABELS } from '@jobbank/shared';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ApplicantProfile } from '@/domains/applicant';
import { formatDate } from '@/lib/format/date';
import { apiFetch } from '@/lib/api/client';
import { RegistrationTokenQr } from './RegistrationTokenQr';

interface MasterDataOption {
  id: string;
  code: string;
  label: string;
  parentId: string | null;
}

const labelOf = (options: MasterDataOption[], code: string | null | undefined): string =>
  (code && options.find((o) => o.code === code)?.label) || code || '';

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="registration-form-section grid gap-2 rounded-md border border-gray-400 p-3">
      <h2 className="border-b border-gray-500 pb-1 text-sm font-bold tracking-wide uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="registration-form-field grid gap-1">
      <span className="text-xs font-medium">{label}</span>
      <strong className="min-h-7 border-b border-gray-500 py-1 font-normal">{value ?? ''}</strong>
    </div>
  );
}

export function RegistrationFormPrint({
  profile,
  branchName,
  onReady,
}: {
  profile: ApplicantProfile;
  branchName: string;
  /**
   * Fired once everything the printout depends on has settled: the
   * master-data labels (codes resolved to human labels, or the fetch failed
   * and raw codes are the fallback), the QR code, and the logo image.
   * Print triggers must wait for this — printing earlier shows raw codes
   * and "Preparing QR code…" on the paper form.
   */
  onReady?: () => void;
}) {
  const { personal, address, preferences } = profile;
  // Resolve master-data codes to human labels so the signed paper form shows
  // e.g. "Bachelor's" instead of "BACHELORS". Unknown codes fall back to the
  // raw code so nothing ever prints blank.
  const [cities, setCities] = useState<MasterDataOption[]>([]);
  const [areas, setAreas] = useState<MasterDataOption[]>([]);
  const [educationLevels, setEducationLevels] = useState<MasterDataOption[]>([]);
  const [jobCategories, setJobCategories] = useState<MasterDataOption[]>([]);
  const [skills, setSkills] = useState<MasterDataOption[]>([]);
  const [labelsSettled, setLabelsSettled] = useState(false);
  const [qrSettled, setQrSettled] = useState(false);
  const [logoSettled, setLogoSettled] = useState(false);
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (labelsSettled && qrSettled && logoSettled && !notifiedRef.current) {
      notifiedRef.current = true;
      onReady?.();
    }
  }, [labelsSettled, qrSettled, logoSettled, onReady]);

  useEffect(() => {
    let active = true;
    Promise.all(
      ['CITY', 'AREA', 'EDUCATION_LEVEL', 'JOB_CATEGORY', 'SKILL'].map((type) =>
        apiFetch<MasterDataOption[]>(`/api/v1/master-data?type=${type}`).then(({ data }) => data),
      ),
    )
      .then(([cityOptions, areaOptions, levels, categories, skillOptions]) => {
        if (!active) return;
        setCities(cityOptions ?? []);
        setAreas(areaOptions ?? []);
        setEducationLevels(levels ?? []);
        setJobCategories(categories ?? []);
        setSkills(skillOptions ?? []);
      })
      .catch(() => {
        // Labels fall back to the raw codes on the print form.
      })
      .finally(() => {
        if (active) setLabelsSettled(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="registration-form-print-root">
      <article className="registration-form-print-sheet grid gap-3 text-gray-950">
        <header className="grid grid-cols-[1fr_auto] items-center gap-4 border-b-2 border-gray-800 pb-2">
          <div className="grid gap-1">
            <div className="flex items-center gap-3">
              {/* Audit 2026-11-11 (L-37): next/image, unoptimized — a print
                  form must render the exact asset, not an optimizer round-trip. */}
              <Image
                src="/logo.png"
                alt="Saylani Job Bank — Connecting Talent with Opportunity"
                width={120}
                height={40}
                className="h-10 w-[120px] shrink-0 object-contain"
                onLoad={() => setLogoSettled(true)}
                onError={() => setLogoSettled(true)}
                unoptimized
              />
              <p className="text-xs font-semibold tracking-widest uppercase">Saylani Job Bank</p>
            </div>
            <h1 className="text-xl font-bold">Applicant Registration Form</h1>
            <p className="text-sm">Branch: {branchName}</p>
            <p className="text-xs">
              Registration reference: <span className="font-mono">{profile.id}</span>
            </p>
          </div>
          <div className="grid justify-items-center gap-1">
            <RegistrationTokenQr
              value={profile.id}
              width={180}
              onReady={() => setQrSettled(true)}
            />
            <span className="text-xs">Applicant reference QR</span>
          </div>
        </header>

        <FormSection title="1. Basic personal information">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="Full name" value={personal.fullName} />
            <Field label="Father's or husband's name" value={personal.fatherName} />
            <Field label="Phone" value={personal.phone} />
            <Field label="Email" value={personal.email} />
            <Field label="CNIC" value={personal.cnic} />
            <Field label="Date of birth" value={formatDate(personal.dateOfBirth)} />
            <Field label="Gender" value={GENDER_LABELS[personal.gender]} />
          </div>
        </FormSection>

        <FormSection title="2. Educational background">
          {profile.education.length ? (
            profile.education.map((item, index) => (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2" key={`${item.levelCode}-${index}`}>
                <Field
                  label="Education level / qualification"
                  value={labelOf(educationLevels, item.levelCode)}
                />
                <Field label="Field of study" value={item.fieldOfStudy} />
                <Field label="Institution" value={item.institution} />
                <Field
                  label="Completion year / current"
                  value={item.isCurrent ? 'Current' : item.completionYear}
                />
                <Field label="Grade / marks" value={item.grade} />
              </div>
            ))
          ) : (
            <Field label="Education level, qualifications and institution" />
          )}
          {profile.certifications.map((item, index) => (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2" key={`${item.name}-${index}`}>
              <Field label="Certification" value={item.name} />
              <Field label="Issuing organization" value={item.issuer} />
              <Field label="Issued" value={item.issuedMonth} />
              <Field label="Expires" value={item.expiresMonth} />
            </div>
          ))}
          {!profile.certifications.length && <Field label="Certifications" />}
        </FormSection>

        <FormSection title="3. Work experience and skills">
          {profile.hasNoExperience ? (
            <Field label="Previous employment" value="No previous work experience" />
          ) : profile.experience.length ? (
            profile.experience.map((item, index) => (
              <div
                className="grid grid-cols-2 gap-x-4 gap-y-2"
                key={`${item.employerName}-${index}`}
              >
                <Field label="Employer / organization" value={item.employerName} />
                <Field label="Job title / role" value={item.jobTitle} />
                <Field label="Work category" value={labelOf(jobCategories, item.categoryCode)} />
                <Field
                  label="Employment dates"
                  value={`${item.startMonth} - ${item.isCurrent ? 'Current' : (item.endMonth ?? '')}`}
                />
                <div className="col-span-2">
                  <Field label="Duties / professional background" value={item.description} />
                </div>
              </div>
            ))
          ) : (
            <Field label="Previous employment and professional background" />
          )}
          {profile.skills.length ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {profile.skills.map((skill) => (
                <Field
                  key={skill.skillCode}
                  label="Skill"
                  value={`${labelOf(skills, skill.skillCode)} - ${SKILL_LEVEL_LABELS[skill.level]} (${skill.years} years)`}
                />
              ))}
            </div>
          ) : (
            <Field label="Skills" />
          )}
        </FormSection>

        <FormSection title="4. Work availability and preferences">
          <Field
            label="Preferred work categories / roles"
            value={preferences?.categoryCodes
              .map((code) => labelOf(jobCategories, code))
              .join(', ')}
          />
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field
              label="Preferred working hours / shifts"
              value={preferences?.shifts.map((shift) => SHIFT_LABELS[shift]).join(', ')}
            />
            <Field
              label="Suitable job types"
              value={preferences?.jobTypes.map((type) => JOB_TYPE_LABELS[type]).join(', ')}
            />
            <Field
              label="Available from"
              value={preferences?.availableFrom ? formatDate(preferences.availableFrom) : null}
            />
            <Field label="Minimum salary (PKR)" value={preferences?.minSalaryPkr} />
            <Field label="Other suitable timings" />
          </div>
        </FormSection>

        <FormSection title="5. Residential information">
          <Field label="Current residential address" value={address?.addressLine} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="Area of residence" value={labelOf(areas, address?.areaCode)} />
            <Field label="City" value={labelOf(cities, address?.cityCode)} />
          </div>
          <Field label="Permanent address" value={profile.permanentAddress?.addressLine} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field
              label="Permanent area"
              value={labelOf(areas, profile.permanentAddress?.areaCode)}
            />
            <Field
              label="Permanent city"
              value={labelOf(cities, profile.permanentAddress?.cityCode)}
            />
          </div>
        </FormSection>

        <FormSection title="6. Additional relevant information">
          <Field label="Additional details / assessment notes" value={profile.additionalNotes} />
          <div className="grid grid-cols-2 gap-x-8 gap-y-5 pt-3">
            <Field label="Applicant signature" />
            <Field label="Date" />
            <Field label="Verifying staff member" />
            <Field label="Staff signature" />
          </div>
          <p className="pt-1 text-xs">
            By signing, the applicant confirms that the information on this form is accurate.
          </p>
        </FormSection>
      </article>
    </div>
  );
}
