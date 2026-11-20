'use client';

import type { ApplicantTokenView } from '@jobbank/shared';
import Image from 'next/image';
import { formatPkMobileDisplay } from '@/lib/format/phone';
import { formatDate, formatTime } from '@/lib/format/date';

/**
 * Token slip: Saylani Job Bank title, big token number, detail rows, the
 * Job Bank logo as a centre watermark, and the dashed footer. The same
 * markup renders on screen in the issue dialog and as the print-only
 * portal — the matching styles live in design-system/global.css, with
 * @media print rules that print only this slip, on one page. Compact
 * thermal-ticket sizing (2026-11-16): 80mm wide. On paper it is laid out
 * for the counter's BlackCopper 80mm thermal roll (72mm printable width,
 * named page) — not A4.
 *
 * Values are the live token: the big number is the day's token number,
 * zero-padded to two digits. The Applicant ID row is the 8-character ID
 * reserved at issue. Tokens issued before that ID existed have none, and
 * the row falls back to the token code. The token expires at midnight
 * Pakistan time at the end of the day it was issued.
 *
 * N9 (2026-11-08): the full CNIC is on the slip by design. This is a
 * counter queue ticket, not a record: the bearer paper slip must identify
 * its holder when staff call the number. Trade-off accepted: anyone
 * holding the slip can read the CNIC, so slips should be treated as
 * bearer tokens for the rest of that Pakistan day and not retained. No
 * consent checkbox — the CNIC is required to issue the token at all.
 */
export function ApplicantTokenSlip({ token }: { token: ApplicantTokenView }) {
  const date = formatDate(token.issuedAt);
  const time = formatTime(token.issuedAt);
  const applicantId = token.registrationReference || token.tokenCode;

  return (
    <article className="token-slip">
      {/* Audit 2026-11-11 (L-37): next/image, unoptimized — a print slip must
          render the exact asset, not an optimizer round-trip. */}
      <Image
        className="token-slip__watermark"
        src="/logo.png"
        alt=""
        aria-hidden="true"
        width={2172}
        height={724}
        unoptimized
      />
      <div className="token-slip__content">
        <div className="token-slip__title">
          <h1>Saylani Job Bank</h1>
          <p>Connecting Talent with Opportunity</p>
        </div>
        <hr className="token-slip__divider" />
        <div className="token-slip__number">
          <p className="token-slip__number-label">TOKEN NUMBER</p>
          <p
            className={
              token.tokenNumber >= 1000
                ? 'token-slip__number-value token-slip__number-value--wide'
                : 'token-slip__number-value'
            }
          >
            {String(token.tokenNumber).padStart(2, '0')}
          </p>
        </div>
        <dl className="token-slip__rows">
          <div className="token-slip__row">
            <dt className="token-slip__key">Applicant ID</dt>
            <dd className="token-slip__value">{applicantId}</dd>
          </div>
          <div className="token-slip__row">
            <dt className="token-slip__key">Date &amp; Time</dt>
            <dd className="token-slip__value">
              {date} • {time}
            </dd>
          </div>
          {(token.status !== 'ISSUED' || token.expired) && (
            // Audit 2026-11-11 (M-08): a non-live slip must say so on its
            // face — cancelled / completed / expired can never pass as a
            // valid queue ticket. Valid slips keep the approved format.
            <div className="token-slip__row">
              <dt className="token-slip__key">Status</dt>
              <dd className="token-slip__value">
                {token.status === 'CANCELLED'
                  ? 'CANCELLED — not valid'
                  : token.status === 'COMPLETED'
                    ? 'COMPLETED — not valid as a queue ticket'
                    : 'EXPIRED — not valid'}
              </dd>
            </div>
          )}
          <div className="token-slip__row">
            <dt className="token-slip__key">NIC</dt>
            <dd className="token-slip__value">{token.cnic}</dd>
          </div>
          <div className="token-slip__row">
            <dt className="token-slip__key">Name</dt>
            <dd className="token-slip__value">{token.applicantName}</dd>
          </div>
          <div className="token-slip__row">
            <dt className="token-slip__key">Phone</dt>
            <dd className="token-slip__value">{formatPkMobileDisplay(token.phone)}</dd>
          </div>
        </dl>
        <footer className="token-slip__footer">
          <p>Please keep this token and wait to be called.</p>
          <small>SAYLANI JOB BANK</small>
        </footer>
      </div>
    </article>
  );
}
