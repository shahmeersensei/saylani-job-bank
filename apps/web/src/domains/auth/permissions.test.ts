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

  it('rule 2: only Verification Officers verify companies', () => {
    expect(holders('company:verify')).toEqual(['VERIFIER']);
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

  it('applicant records: staff correct them, only admins move them between branches', () => {
    expect(holders('applicant:verify_identity')).toEqual(['STAFF']);
    expect(holders('applicant:manage')).toEqual(['BRANCH_ADMIN', 'STAFF']);
    expect(holders('applicant:transfer')).toEqual(['SUPER_ADMIN', 'BRANCH_ADMIN']);
    expect(ROLE_PERMISSIONS.EMPLOYER.filter((p) => p.startsWith('applicant:'))).toEqual([]);
  });

  it('only Super Admin oversees all branches and lifts restrictions', () => {
    expect(holders('scope:switch_branch')).toEqual(['SUPER_ADMIN']);
    expect(holders('restriction:lift')).toEqual(['SUPER_ADMIN']);
  });

  it('Job Bank staff and branch admins refer candidates and run Job Bank interviews', () => {
    expect(holders('match_case:refer')).toEqual(['BRANCH_ADMIN', 'STAFF']);
    expect(holders('interview:schedule_jobbank')).toEqual(['BRANCH_ADMIN', 'STAFF']);
  });

  it('every assigned permission exists in the catalogue', () => {
    for (const role of ROLES)
      for (const p of ROLE_PERMISSIONS[role]) expect(ALL_PERMISSIONS).toContain(p);
  });

  it('combines permissions across roles and picks the most senior home page', () => {
    expect(permissionsFor(['VERIFIER', 'STAFF']).has('company:verify')).toBe(true);
    expect(permissionsFor(['VERIFIER', 'STAFF']).has('match_case:refer')).toBe(true);
    expect(homePathFor(['STAFF', 'BRANCH_ADMIN'])).toBe('/branch-admin');
    expect(homePathFor(['APPLICANT'])).toBe('/applicant');
    expect(homePathFor([])).toBe('/');
  });
});
