import { describe, expect, it } from 'vitest';
import { ForbiddenError, InvalidTransitionError } from '@/domains/shared/errors';
import { companyMachine, READY } from './machine';

/**
 * Audit round 2: H20 (Super Admin suspend/reinstate) and M24 (no REJECT
 * from INFO_REQUESTED). Pure machine checks — no DB.
 * 2026-11-14: verification moved from Verifier to Branch Admin — VERIFY,
 * REJECT and REQUEST_INFO are Branch Admin-only and also allowed straight
 * from DRAFT (field-visit companies) and SUBMITTED.
 */
describe('companyMachine (audit H20, M24)', () => {
  it('M24: REJECT is allowed from UNDER_VERIFICATION and RESUBMITTED', () => {
    expect(companyMachine.transition('UNDER_VERIFICATION', 'REJECT', READY, ['BRANCH_ADMIN'])).toBe(
      'REJECTED',
    );
    expect(companyMachine.transition('RESUBMITTED', 'REJECT', READY, ['BRANCH_ADMIN'])).toBe(
      'REJECTED',
    );
  });

  it('Branch Admin verifies and rejects straight from DRAFT and SUBMITTED', () => {
    expect(companyMachine.transition('DRAFT', 'VERIFY', READY, ['BRANCH_ADMIN'])).toBe('VERIFIED');
    expect(companyMachine.transition('SUBMITTED', 'VERIFY', READY, ['BRANCH_ADMIN'])).toBe(
      'VERIFIED',
    );
    expect(companyMachine.transition('DRAFT', 'REJECT', READY, ['BRANCH_ADMIN'])).toBe('REJECTED');
    expect(companyMachine.transition('DRAFT', 'REQUEST_INFO', READY, ['BRANCH_ADMIN'])).toBe(
      'INFO_REQUESTED',
    );
  });

  it('Verifier can no longer verify, reject or request info', () => {
    expect(() => companyMachine.transition('DRAFT', 'VERIFY', READY, ['VERIFIER'])).toThrow(
      ForbiddenError,
    );
    expect(() => companyMachine.transition('DRAFT', 'REJECT', READY, ['VERIFIER'])).toThrow(
      ForbiddenError,
    );
    expect(() =>
      companyMachine.transition('UNDER_VERIFICATION', 'REQUEST_INFO', READY, ['VERIFIER']),
    ).toThrow(ForbiddenError);
  });

  it('M24: REJECT from INFO_REQUESTED is not a transition', () => {
    expect(() =>
      companyMachine.transition('INFO_REQUESTED', 'REJECT', READY, ['BRANCH_ADMIN']),
    ).toThrow(InvalidTransitionError);
  });

  it('H20: SUPER_ADMIN can suspend a VERIFIED company and reinstate it', () => {
    expect(companyMachine.transition('VERIFIED', 'SUSPEND', READY, ['SUPER_ADMIN'])).toBe(
      'SUSPENDED',
    );
    expect(companyMachine.transition('SUSPENDED', 'REINSTATE', READY, ['SUPER_ADMIN'])).toBe(
      'VERIFIED',
    );
  });

  it('H20: BRANCH_ADMIN keeps suspend/reinstate; VERIFIER and STAFF cannot', () => {
    expect(companyMachine.transition('VERIFIED', 'SUSPEND', READY, ['BRANCH_ADMIN'])).toBe(
      'SUSPENDED',
    );
    expect(() => companyMachine.transition('VERIFIED', 'SUSPEND', READY, ['VERIFIER'])).toThrow(
      ForbiddenError,
    );
    expect(() => companyMachine.transition('SUSPENDED', 'REINSTATE', READY, ['STAFF'])).toThrow(
      ForbiddenError,
    );
  });
});
