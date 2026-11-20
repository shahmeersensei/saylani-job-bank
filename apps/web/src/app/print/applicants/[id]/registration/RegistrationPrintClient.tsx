'use client';

import {
  GENDER_LABELS,
  JOB_TYPE_LABELS,
  LANGUAGE_PROFICIENCY_LABELS,
  SHIFT_LABELS,
  SKILL_LEVEL_LABELS,
} from '@jobbank/shared';
import { AlertTriangle, Printer, RefreshCw } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/atoms';
import { APPLICANT_STATUS_PILL } from '@/app/(dashboard)/_components/applicants/labels';
import type { DocumentLink, RegistrationFormData } from '@/domains/applicant';
import { apiFetch, friendlyApiError } from '@/lib/api/client';
import { formatCnic } from '@/lib/format/cnic';
import { formatDate } from '@/lib/format/date';
import { formatPkMobileDisplay } from '@/lib/format/phone';

function monthLabel(value: string | null): string {
  return value
    ? new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-PK', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'Not provided';
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="registration-print-field">
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === '' ? 'Not provided' : value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="registration-print-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Fresh view link for a document. Links live only 120 seconds, so the
 * photo URL is never stored in the form payload — it is fetched when the
 * print page loads and again on print, so it cannot expire in between.
 */
async function fetchPhotoUrl(applicantId: string, documentId: string): Promise<string> {
  const { data } = await apiFetch<DocumentLink>(
    `/api/v1/applicants/${applicantId}/documents/${documentId}/url`,
  );
  return data.url;
}

export function RegistrationPrintClient({ applicantId }: { applicantId: string }) {
  const [form, setForm] = useState<RegistrationFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [qrLoaded, setQrLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  /** True once the embedded photo failed and the client fell back to the download link. */
  const [photoUseDownload, setPhotoUseDownload] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  const qrRef = useRef<HTMLImageElement>(null);
  // Passport photo (2026-11-17): the captured PHOTO document, fetched as a
  // fresh signed URL. `photoSettled` starts true (no photo) and only goes
  // false while a photo URL/image is still loading.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // Only the setter is still used (header photo removed).
  const [, setPhotoSettled] = useState(true);
  const photoRef = useRef<HTMLImageElement>(null);
  const photoDocIdRef = useRef<string | null>(null);

  const loadForm = async () => {
    setLoading(true);
    setError(null);
    setForm(null);
    setLogoLoaded(false);
    setQrLoaded(false);
    setImageError(false);
    setPhotoFailed(false);
    setPhotoUseDownload(false);
    try {
      const { data } = await apiFetch<RegistrationFormData>(
        `/api/v1/applicants/${applicantId}/registration-form`,
        { method: 'POST' },
      );
      setForm(data);
    } catch (cause) {
      setError(friendlyApiError(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data } = await apiFetch<RegistrationFormData>(
          `/api/v1/applicants/${applicantId}/registration-form`,
          { method: 'POST' },
        );
        if (active) setForm(data);
      } catch (cause) {
        if (active) {
          setError(friendlyApiError(cause));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applicantId]);

  useEffect(() => {
    if (!form) return;
    const logo = logoRef.current;
    const qr = qrRef.current;
    if (logo?.complete && logo.naturalWidth > 0) setLogoLoaded(true);
    if (qr?.complete && qr.naturalWidth > 0) setQrLoaded(true);
    const photo = photoRef.current;
    if (photo?.complete && photo.naturalWidth > 0) setPhotoSettled(true);
  }, [form, photoUrl]);

  // Fetch a fresh photo URL whenever the form (re)loads with a photo
  // document. No photo → nothing to fetch, and the print gate stays open.
  useEffect(() => {
    if (!form?.photoDocumentId) {
      photoDocIdRef.current = null;
      setPhotoUrl(null);
      setPhotoFailed(false);
      setPhotoSettled(true);
      return;
    }
    if (photoDocIdRef.current === form.photoDocumentId && photoUrl) return;
    photoDocIdRef.current = form.photoDocumentId;
    let active = true;
    setPhotoFailed(false);
    setPhotoSettled(false);
    void fetchPhotoUrl(applicantId, form.photoDocumentId)
      .then((url) => {
        if (active) setPhotoUrl(url);
      })
      .catch(() => {
        // A failed link must not block the form: print without the photo.
        if (active) {
          setPhotoFailed(true);
          setPhotoSettled(true);
        }
      });
    return () => {
      active = false;
    };
  }, [form, applicantId, photoUrl]);

  // A fresh form resets the photo state, so a retry after a failed load
  // starts from the embedded copy again instead of a stale fallback.
  useEffect(() => {
    setPhotoFailed(false);
    setPhotoUseDownload(false);
  }, [form?.photoDataUrl, form?.photoUrl]);

  const replaceCode = async () => {
    if (
      !window.confirm(
        'Replace this QR verification code? Any previously printed form will no longer verify.',
      )
    ) {
      return;
    }
    setWorking(true);
    try {
      await apiFetch(`/api/v1/applicants/${applicantId}/verification-token/regenerate`, {
        method: 'POST',
      });
      await loadForm();
    } catch (cause) {
      setError(friendlyApiError(cause));
    } finally {
      setWorking(false);
    }
  };

  // The photo is shown once, in the Personal information section, so the
  // header photo was removed and printing no longer waits for it to load.
  // The photo is shown once, in the Personal information section, so the
  // header photo was removed and printing no longer waits for it to load.
  const readyToPrint = Boolean(form && logoLoaded && qrLoaded && !imageError && !loading);

  /**
   * Refresh the photo link before printing: the 120-second URL fetched at
   * load time may have expired while staff reviewed the form. The fresh
   * URL is preloaded (so the printed <img> is already cached), pointed
   * at, and given one paint before the print dialog opens. A failed
   * refresh never blocks printing — the existing photo (or none) prints.
   */
  const handlePrint = async () => {
    if (form?.photoDocumentId) {
      try {
        const url = await fetchPhotoUrl(applicantId, form.photoDocumentId);
        // Preload the fresh URL so the <img> in the document is already
        // cached when print opens — but never let a stalled image block
        // printing: the wait is capped at 1.5s.
        await new Promise<void>((resolve) => {
          const img = new window.Image();
          const done = () => resolve();
          img.onload = done;
          img.onerror = done;
          img.src = url;
          setTimeout(done, 1500);
        });
        setPhotoUrl(url);
        setPhotoFailed(false);
        await new Promise((resolve) => setTimeout(resolve, 0));
      } catch {
        // Keep the existing photo URL (or no photo) and print anyway.
      }
    }
    window.print();
  };

  return (
    <main className="registration-print-page">
      <div className="registration-print-controls" aria-label="Print controls">
        <Button variant="secondary" onClick={() => window.history.back()}>
          Back
        </Button>
        <div className="flex flex-wrap gap-2">
          {form?.canRegenerate && (
            <Button
              variant="secondary"
              leftIcon={<RefreshCw />}
              loading={working}
              disabled={working || loading}
              onClick={replaceCode}
            >
              Replace QR code
            </Button>
          )}
          <Button
            leftIcon={<Printer />}
            disabled={!readyToPrint}
            onClick={() => void handlePrint()}
          >
            {readyToPrint ? 'Print Registration Form' : 'Preparing form…'}
          </Button>
        </div>
      </div>

      {loading && (
        <p className="registration-print-state">Loading the latest saved applicant record…</p>
      )}
      {error && (
        <div className="registration-print-state registration-print-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <p>{error}</p>
          <Button variant="secondary" onClick={() => void loadForm()}>
            Try again
          </Button>
        </div>
      )}
      {imageError && (
        <p className="registration-print-state registration-print-error" role="alert">
          The logo or QR code could not be loaded. Printing is disabled until both images are ready.
        </p>
      )}

      {form && (
        <article className="registration-print-document">
          <header className="registration-print-header">
            <Image
              ref={logoRef}
              src="/logo.png"
              width={180}
              height={90}
              alt="Saylani"
              priority
              onLoad={() => setLogoLoaded(true)}
              onError={() => setImageError(true)}
              className="registration-print-logo"
            />
            <div className="registration-print-title">
              <p>SAYLANI JOB BANK</p>
              <h1>JOB SEEKER REGISTRATION FORM</h1>
              <p>Official registration record</p>
            </div>
            <div className="registration-print-reference">
              <strong>{form.registrationReference}</strong>
              <span>{formatDate(form.registeredAt)}</span>
            </div>
          </header>

          <dl className="registration-print-summary">
            <Field label="Registration reference" value={form.registrationReference} />
            <Field label="Registration date" value={formatDate(form.registeredAt)} />
            <Field label="Branch" value={form.branchName} />
            <Field label="Registration status" value={APPLICANT_STATUS_PILL[form.status].label} />
          </dl>

          <Section title="Personal information">
            <div className="registration-print-personal">
              <dl className="registration-print-grid">
                <Field label="Full name" value={form.personal.fullName} />
                <Field label="Father's / husband's name" value={form.personal.fatherName} />
                <Field label="CNIC" value={formatCnic(form.personal.cnic)} />
                <Field label="Date of birth" value={formatDate(form.personal.dateOfBirth)} />
                <Field label="Gender" value={GENDER_LABELS[form.personal.gender]} />
              </dl>
              {(() => {
                // Prefer the embedded copy (self-contained printout). When
                // the server could not embed the photo, or the embedded copy
                // fails to render, fall back to the download route — the same
                // one the profile page views the photo through. Only when
                // neither source works does the box say the photo could not
                // be loaded, so that is never confused with "no photo on file".
                const photoSrc =
                  !photoUseDownload && form.photoDataUrl ? form.photoDataUrl : form.photoUrl;
                return photoSrc && !photoFailed ? (
                  <Image
                    src={photoSrc}
                    width={140}
                    height={180}
                    alt="Applicant photo"
                    unoptimized
                    onError={() => {
                      if (!photoUseDownload && form.photoDataUrl && form.photoUrl) {
                        setPhotoUseDownload(true);
                      } else {
                        setPhotoFailed(true);
                      }
                    }}
                    className="registration-print-photo"
                  />
                ) : (
                  <div
                    className="registration-print-photo registration-print-photo--empty"
                    aria-label={
                      photoFailed
                        ? 'Applicant photo could not be loaded'
                        : 'No applicant photo on file'
                    }
                  >
                    {photoFailed ? 'Photo could not be loaded' : 'No photo on file'}
                  </div>
                );
              })()}
            </div>
          </Section>

          <Section title="Contact information">
            <dl className="registration-print-grid">
              <Field
                label="Phone number"
                value={form.personal.phone ? formatPkMobileDisplay(form.personal.phone) : null}
              />
              <Field label="Email" value={form.personal.email} />
            </dl>
          </Section>

          <Section title="Residential address">
            {form.address ? (
              <dl className="registration-print-grid">
                <Field label="Address" value={form.address.addressLine} />
                <Field label="Area" value={form.address.area} />
                <Field label="City" value={form.address.city} />
              </dl>
            ) : (
              <p className="registration-print-empty">No residential address recorded.</p>
            )}
          </Section>

          <Section title="Education">
            {form.education.length ? (
              <table className="registration-print-table">
                <thead>
                  <tr>
                    <th>Qualification</th>
                    <th>Institution / field</th>
                    <th>Year / status</th>
                    <th>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {form.education.map((item, index) => (
                    <tr key={`${item.level}-${index}`}>
                      <td>{item.level}</td>
                      <td>
                        {[item.institution, item.fieldOfStudy].filter(Boolean).join(' · ') ||
                          'Not provided'}
                      </td>
                      <td>
                        {item.isCurrent
                          ? 'Currently studying'
                          : (item.completionYear ?? 'Not provided')}
                      </td>
                      <td>{item.grade || 'Not provided'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="registration-print-empty">No education records provided.</p>
            )}
          </Section>

          <Section title="Work experience">
            {form.hasNoExperience ? (
              <p className="registration-print-empty">No Previous Work Experience</p>
            ) : form.experience.length ? (
              <table className="registration-print-table">
                <thead>
                  <tr>
                    <th>Organization / designation</th>
                    <th>Duration</th>
                    <th>Category / responsibilities</th>
                  </tr>
                </thead>
                <tbody>
                  {form.experience.map((item, index) => (
                    <tr key={`${item.employerName}-${index}`}>
                      <td>
                        <strong>{item.employerName}</strong>
                        <br />
                        {item.jobTitle}
                      </td>
                      <td>
                        {monthLabel(item.startMonth)} –{' '}
                        {item.isCurrent ? 'Present' : monthLabel(item.endMonth)}
                      </td>
                      <td>
                        {[item.category, item.description].filter(Boolean).join(' · ') ||
                          'Not provided'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="registration-print-empty">No work experience records provided.</p>
            )}
          </Section>

          <Section title="Skills">
            {form.skills.length ? (
              <ul className="registration-print-list">
                {form.skills.map((skill) => (
                  <li key={`${skill.name}-${skill.level}`}>
                    {skill.name} — {SKILL_LEVEL_LABELS[skill.level]}
                    {skill.years ? ` · ${skill.years} year${skill.years === 1 ? '' : 's'}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="registration-print-empty">No skills recorded.</p>
            )}
          </Section>

          <Section title="Languages">
            {form.languages.length ? (
              <ul className="registration-print-list">
                {form.languages.map((language) => (
                  <li key={language.name}>
                    {language.name} — {LANGUAGE_PROFICIENCY_LABELS[language.proficiency]}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="registration-print-empty">No languages recorded.</p>
            )}
          </Section>

          <Section title="Certifications">
            {form.certifications.length ? (
              <ul className="registration-print-list">
                {form.certifications.map((certification, index) => (
                  <li key={`${certification.name}-${index}`}>
                    <strong>{certification.name}</strong>
                    {certification.issuer ? ` · ${certification.issuer}` : ''}
                    {certification.issuedMonth
                      ? ` · Issued ${monthLabel(certification.issuedMonth)}`
                      : ''}
                    {certification.expiresMonth
                      ? ` · Expires ${monthLabel(certification.expiresMonth)}`
                      : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="registration-print-empty">No certifications recorded.</p>
            )}
          </Section>

          <Section title="Job preferences">
            {form.preferences ? (
              <dl className="registration-print-grid">
                <Field
                  label="Preferred categories"
                  value={form.preferences.categories.join(', ') || 'Any'}
                />
                <Field
                  label="Employment type"
                  value={
                    form.preferences.jobTypes.map((type) => JOB_TYPE_LABELS[type]).join(', ') ||
                    'Any'
                  }
                />
                <Field
                  label="Preferred shifts"
                  value={
                    form.preferences.shifts.map((shift) => SHIFT_LABELS[shift]).join(', ') || 'Any'
                  }
                />
                <Field
                  label="Minimum salary"
                  value={
                    form.preferences.minSalaryPkr
                      ? `PKR ${form.preferences.minSalaryPkr.toLocaleString('en-PK')}`
                      : 'Flexible'
                  }
                />
                <Field
                  label="Available from"
                  value={
                    form.preferences.availableFrom
                      ? formatDate(form.preferences.availableFrom)
                      : 'Not provided'
                  }
                />
                <Field
                  label="Travel radius"
                  value={
                    form.preferences.willingRadiusM
                      ? `${(form.preferences.willingRadiusM / 1000).toLocaleString('en-PK')} km`
                      : null
                  }
                />
              </dl>
            ) : (
              <p className="registration-print-empty">No job preferences recorded.</p>
            )}
          </Section>

          <Section title="Registration details">
            <dl className="registration-print-grid">
              <Field label="Registration source" value={form.registrationSource} />
              <Field label="Branch" value={form.branchName} />
              <Field label="Registered by" value={form.registeredByName} />
            </dl>
          </Section>

          <div className="registration-print-bottom">
            <section className="registration-print-signatures" aria-label="Signatures">
              <div>
                <span>Applicant signature</span>
                <i />
                <small>Date: __________________</small>
              </div>
              <div>
                <span>Authorized administrator signature</span>
                <i />
                <small>Date: __________________</small>
              </div>
            </section>
            <aside className="registration-print-qr">
              <Image
                ref={qrRef}
                src={form.verificationQrDataUrl}
                width={144}
                height={144}
                alt="QR code for secure registration verification"
                unoptimized
                onLoad={() => setQrLoaded(true)}
                onError={() => setImageError(true)}
              />
              <strong>Scan to Verify Registration</strong>
            </aside>
          </div>
          <footer className="registration-print-footer">
            This document contains personal information. Handle and store it securely.
          </footer>
        </article>
      )}
    </main>
  );
}
