import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApplicantTokenView } from '@jobbank/shared';
import { ApplicantTokenSlip } from './ApplicantTokenSlip';

const token: ApplicantTokenView = {
  id: '00000000-0000-0000-0000-000000000001',
  tokenNumber: 1,
  tokenCode: 'KHI-GULSHAN-001',
  branchId: '00000000-0000-0000-0000-000000000002',
  branchCode: 'KHI-GULSHAN',
  branchName: 'Karachi — Gulshan-e-Iqbal',
  cnic: '4240127739744',
  applicantName: 'Test Applicant',
  phone: '+923001234567',
  // 19:39:20 PKT on 2026-11-07.
  issuedAt: '2026-11-07T14:39:20.000Z',
  // Midnight PKT at the end of 2026-11-07.
  expiresAt: '2026-11-07T19:00:00.000Z',
  expired: false,
  status: 'ISSUED',
  applicantId: null,
  registrationReference: 'K7M2X9QP',
};

describe('ApplicantTokenSlip', () => {
  it('renders the demo slip: badge, padded number, date, time, raw NIC, name, phone', () => {
    render(<ApplicantTokenSlip token={token} />);

    expect(screen.queryByText('TOKEN SLIP')).not.toBeInTheDocument();
    expect(screen.queryByText('Valid Until')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Saylani')).not.toBeInTheDocument();
    expect(document.querySelector('img[src="/saylani-logo.png"]')).not.toBeInTheDocument();
    expect(document.querySelector('img[src="/logo.png"]')).toBeInTheDocument();
    expect(screen.getByText('Saylani Job Bank')).toBeInTheDocument();
    expect(screen.getByText('Connecting Talent with Opportunity')).toBeInTheDocument();
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('Applicant ID')).toBeInTheDocument();
    expect(screen.getByText('K7M2X9QP')).toBeInTheDocument();
    expect(screen.queryByText('KHI-GULSHAN-001')).not.toBeInTheDocument();
    expect(screen.getByText('07/11/2026 • 7:39 pm')).toBeInTheDocument();
    expect(screen.getByText('4240127739744')).toBeInTheDocument();
    expect(screen.getByText('Test Applicant')).toBeInTheDocument();
    expect(screen.getByText('+92 300 1234567')).toBeInTheDocument();
    expect(screen.getByText('Please keep this token and wait to be called.')).toBeInTheDocument();
    expect(screen.getByText('SAYLANI JOB BANK')).toBeInTheDocument();
  });

  it('falls back to the token code when the token has no reserved applicant ID', () => {
    render(<ApplicantTokenSlip token={{ ...token, registrationReference: null }} />);
    expect(screen.getByText('KHI-GULSHAN-001')).toBeInTheDocument();
    expect(screen.queryByText('K7M2X9QP')).not.toBeInTheDocument();
  });

  it('pads two-digit token numbers and leaves larger numbers alone', () => {
    const { rerender } = render(<ApplicantTokenSlip token={{ ...token, tokenNumber: 12 }} />);
    expect(screen.getByText('12')).toBeInTheDocument();

    rerender(<ApplicantTokenSlip token={{ ...token, tokenNumber: 123 }} />);
    expect(screen.getByText('123')).toBeInTheDocument();
  });
});
