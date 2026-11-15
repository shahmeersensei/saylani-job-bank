'use client';

import { COMPANY_SIZE_LABELS, LEGAL_STRUCTURE_LABELS } from '@jobbank/shared';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { CompanyOnboarding, CompanyView } from '@/domains/company';
import { formatDate } from '@/lib/format/date';
import { RegistrationTokenQr } from '../applicants/RegistrationTokenQr';

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

export function CompanyRegistrationFormPrint({
  company,
  onboarding,
  industryLabel,
  onReady,
}: {
  company: CompanyView;
  onboarding: CompanyOnboarding;
  industryLabel?: string | null;
  /**
   * Fired once everything the printout depends on has settled: the QR code
   * and the logo image. (The industry label is resolved by the parent — its
   * fetch must be settled before the print trigger fires too.) Print
   * triggers must wait for this — printing earlier shows "Preparing QR
   * code…" on the paper form.
   */
  onReady?: () => void;
}) {
  const { details } = company;
  const primary = company.contacts.find((c) => c.isPrimary) ?? company.contacts[0];
  const { notes } = onboarding;
  const [qrSettled, setQrSettled] = useState(false);
  const [logoSettled, setLogoSettled] = useState(false);
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (qrSettled && logoSettled && !notifiedRef.current) {
      notifiedRef.current = true;
      onReady?.();
    }
  }, [qrSettled, logoSettled, onReady]);
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
            <h1 className="text-xl font-bold">Company Registration Form</h1>
            <p className="text-sm">Branch: {company.branch?.name ?? ''}</p>
            <p className="text-xs">
              Registration reference: <span className="font-mono">{company.id}</span>
            </p>
          </div>
          <div className="grid justify-items-center gap-1">
            <RegistrationTokenQr
              value={company.id}
              width={180}
              onReady={() => setQrSettled(true)}
            />
            <span className="text-xs">Company reference QR</span>
          </div>
        </header>

        <FormSection title="1. Company details">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="Legal name" value={details.legalName} />
            <Field label="Trading name" value={details.tradeName} />
            <Field label="NTN" value={details.ntn} />
            <Field label="Registration No." value={details.registrationNo} />
            <Field label="Legal structure" value={LEGAL_STRUCTURE_LABELS[details.legalStructure]} />
            <Field label="Industry" value={industryLabel ?? details.industryCode} />
            <Field label="Company size" value={COMPANY_SIZE_LABELS[details.sizeBand]} />
            <Field label="Website" value={details.website} />
            <div className="col-span-2">
              <Field label="Description" value={details.description} />
            </div>
          </div>
        </FormSection>

        <FormSection title="2. Contact person">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="Contact person" value={primary?.name} />
            <Field label="Designation" value={primary?.designation} />
            <Field label="Phone" value={primary?.phone} />
            <Field label="Email" value={primary?.email} />
          </div>
        </FormSection>

        <FormSection title="3. Outreach record">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field
              label="Onboarded by"
              value={
                onboarding.onboardedBy
                  ? `${onboarding.onboardedBy.name ?? ''}${onboarding.onboardedBy.roleLabel ? ` (${onboarding.onboardedBy.roleLabel})` : ''}`
                  : null
              }
            />
            <Field
              label="Visit date"
              value={onboarding.visitDate ? formatDate(onboarding.visitDate) : null}
            />
          </div>
        </FormSection>

        <FormSection title="4. Address & locations">
          <Field label="Head-office address" value={notes.headOfficeAddress} />
          <Field label="Other sites" value={notes.otherSites} />
        </FormSection>

        <FormSection title="5. Additional information">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="Roles to hire for" value={notes.workforceRoles} />
            <Field label="Type of work" value={notes.workforceType} />
            <Field label="Shifts / timings" value={notes.workforceShifts} />
            <Field label="Number of openings" value={notes.workforceOpenings} />
            <Field label="Years in business" value={notes.yearsInBusiness} />
            <Field label="Certifications" value={notes.certifications} />
            <div className="col-span-2">
              <Field label="Previous hiring experience" value={notes.previousHiring} />
            </div>
          </div>
          <Field label="Additional details / assessment notes" value={notes.additionalNotes} />
          <div className="grid grid-cols-2 gap-x-8 gap-y-5 pt-3">
            <Field label="Company representative signature" />
            <Field label="Date" />
            <Field label="Verifying staff member" />
            <Field label="Staff signature" />
          </div>
          <p className="pt-1 text-xs">
            By signing, the company representative confirms that the information on this form is
            accurate.
          </p>
        </FormSection>
      </article>
    </div>
  );
}
