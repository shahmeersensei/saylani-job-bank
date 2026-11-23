import {
  ALL_PERMISSIONS,
  homePathFor,
  permissionsFor,
  ROLE_PERMISSIONS,
  ROLES,
  type Permission,
  type Role,
} from '@jobbank/shared';
import { describe, expect, it } from 'vitest';

const holders = (permission: Permission): Role[] =>
  ROLES.filter((role) => ROLE_PERMISSIONS[role].includes(permission));

describe('permission matrix encodes the PRD rules', () => {
  it('rule 7: only Branch Admin makes final blacklist decisions', () => {
    expect(holders('blacklist:decide')).toEqual(['BRANCH_ADMIN']);
  });

  it('rule 2: only Branch Admins verify companies (2026-11-14: moved from Verifier)', () => {
    expect(holders('company:verify')).toEqual(['BRANCH_ADMIN']);
    expect(ROLE_PERMISSIONS.VERIFIER).not.toContain('company:verify');
  });

  it('field-visit onboarding: branch admins, verifiers and Super Admin onboard companies — staff do not', () => {
    expect(holders('company:onboard')).toEqual(['SUPER_ADMIN', 'BRANCH_ADMIN', 'VERIFIER']);
    // Onboarding alone is not suspension: only Branch Admin and Super Admin suspend companies.
    expect(holders('company:suspend')).toEqual(['SUPER_ADMIN', 'BRANCH_ADMIN']);
    expect(ROLE_PERMISSIONS.VERIFIER).not.toContain('company:suspend');
  });

  it('verifiers manage companies and post jobs for them', () => {
    expect(holders('company:manage')).toEqual(['SUPER_ADMIN', 'BRANCH_ADMIN', 'VERIFIER']);
    expect(holders('job:manage')).toEqual(['BRANCH_ADMIN', 'VERIFIER', 'STAFF']);
    // N20: Super Admin bypasses the employer field restrictions via an
    // explicit role bypass (domains/job/rules.ts), NOT via `job:manage` —
    // SA holds no operator permissions, so this must stay false.
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).not.toContain('job:manage');
    expect(ROLE_PERMISSIONS.VERIFIER).toContain('job:read');
    // A verifier creates companies and jobs, but never refers candidates or
    // suspends companies — those stay with staff and branch admins.
    expect(ROLE_PERMISSIONS.VERIFIER).not.toContain('job:refer');
    expect(ROLE_PERMISSIONS.VERIFIER).not.toContain('company:suspend');
  });

  it('rule 5: decisions belong to their actors; nobody holds proxy decisions by default', () => {
    expect(holders('decision:employer')).toEqual(['EMPLOYER']);
    expect(holders('decision:applicant')).toEqual(['APPLICANT']);
    expect(holders('decision:proxy')).toEqual([]);
  });

  it('rule 3: employers can never read applicant profiles directly', () => {
    expect(ROLE_PERMISSIONS.EMPLOYER).not.toContain('applicant:read');
    expect(ROLE_PERMISSIONS.EMPLOYER).not.toContain('applicant:verify_identity');
  });

  it('applicant records: staff correct them and admins transfer them', () => {
    // Audit 2026-11-11 (L-22): identity verification is no longer STAFF-only.
    // Admins already hold every other applicant power, so blocking this one
    // was an oversight, not separation of duties. The can.verifyIdentity UI
    // flag derives from this permission (applicant/staff.ts), so it mirrors
    // automatically. Super Admin deliberately stays out of the operational
    // referral/interview permissions (match_case:manage/refer, job:refer,
    // interview:schedule_jobbank) — the overseer design is unchanged.
    expect(holders('applicant:verify_identity')).toEqual(['SUPER_ADMIN', 'BRANCH_ADMIN', 'STAFF']);
    expect(holders('applicant:manage')).toEqual(['SUPER_ADMIN', 'BRANCH_ADMIN', 'STAFF']);
    expect(holders('applicant:transfer')).toEqual(['SUPER_ADMIN', 'BRANCH_ADMIN']);
    // Merge (2026-11-10): Rafeh's staff-assisted registration uses
    // applicant:create; Super Admin, Branch Admin and Staff may register
    // applicants on behalf of job seekers. Branch Admin is NOT read-only.
    expect(holders('applicant:create')).toEqual(['SUPER_ADMIN', 'BRANCH_ADMIN', 'STAFF']);
    expect(ROLE_PERMISSIONS.EMPLOYER.filter((p) => p.startsWith('applicant:'))).toEqual([]);
  });

  it('only Super Admin oversees all branches and lifts restrictions', () => {
    expect(holders('scope:switch_branch')).toEqual(['SUPER_ADMIN']);
    expect(holders('restriction:lift')).toEqual(['SUPER_ADMIN']);
  });

  it('Job Bank staff, branch admins and interview schedulers run Job Bank interviews', () => {
    // 0052 — Option B: the interviewer also refers, but only candidates he
    // passed (enforced in referApplicantToEmployer, not by this list alone).
    expect(holders('match_case:refer')).toEqual(['BRANCH_ADMIN', 'INTERVIEWER_SCHEDULER', 'STAFF']);
    expect(holders('interview:schedule_jobbank')).toEqual([
      'BRANCH_ADMIN',
      'INTERVIEWER_SCHEDULER',
      'STAFF',
    ]);
    expect(holders('interview:record_outcome')).toEqual([
      'BRANCH_ADMIN',
      'INTERVIEWER_SCHEDULER',
      'STAFF',
    ]);
  });

  it('the Interviewer and Scheduler role runs the interview stage end-to-end (0052)', () => {
    expect(ROLE_PERMISSIONS.INTERVIEWER_SCHEDULER).toEqual([
      'branch:read',
      'applicant:read',
      'job:read',
      'match_case:read',
      'match_case:refer',
      'interview:schedule_jobbank',
      'interview:record_outcome',
    ]);
    // Still no shortlisting, no employer decisions, no job/company/staff
    // management — the referral is pass-only, enforced server-side.
    expect(ROLE_PERMISSIONS.INTERVIEWER_SCHEDULER).not.toContain('match_case:manage');
    expect(ROLE_PERMISSIONS.INTERVIEWER_SCHEDULER).not.toContain('decision:employer');
    expect(ROLE_PERMISSIONS.INTERVIEWER_SCHEDULER).not.toContain('job:manage');
    expect(ROLE_PERMISSIONS.INTERVIEWER_SCHEDULER).not.toContain('job:refer');
    expect(ROLE_PERMISSIONS.INTERVIEWER_SCHEDULER).not.toContain('applicant:manage');
    expect(ROLE_PERMISSIONS.INTERVIEWER_SCHEDULER).not.toContain('applicant:create');
    expect(ROLE_PERMISSIONS.INTERVIEWER_SCHEDULER).not.toContain('applicant:verify_identity');
    expect(ROLE_PERMISSIONS.INTERVIEWER_SCHEDULER).not.toContain('company:onboard');
    expect(ROLE_PERMISSIONS.INTERVIEWER_SCHEDULER).not.toContain('placement:manage');
    expect(ROLE_PERMISSIONS.INTERVIEWER_SCHEDULER).not.toContain('user:manage');
    expect(ROLE_PERMISSIONS.INTERVIEWER_SCHEDULER).not.toContain('branch:manage');
    expect(homePathFor(['INTERVIEWER_SCHEDULER'])).toBe('/interviewer-scheduler');
  });

  it('every assigned permission exists in the catalogue', () => {
    for (const role of ROLES)
      for (const p of ROLE_PERMISSIONS[role]) expect(ALL_PERMISSIONS).toContain(p);
  });

  it('combines permissions across roles and picks the most senior home page', () => {
    expect(permissionsFor(['BRANCH_ADMIN', 'STAFF']).has('company:verify')).toBe(true);
    expect(permissionsFor(['VERIFIER', 'STAFF']).has('match_case:refer')).toBe(true);
    expect(homePathFor(['STAFF', 'BRANCH_ADMIN'])).toBe('/branch-admin');
    expect(homePathFor(['APPLICANT'])).toBe('/applicant');
    expect(homePathFor([])).toBe('/');
  });
});
