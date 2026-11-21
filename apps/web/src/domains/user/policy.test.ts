import { describe, expect, it } from 'vitest';
import { makeActor } from '@/test/factories';
import { canGrantRole, canManageUser, canSeeUser } from './policy';

const KHI = 'branch-khi';
const LHR = 'branch-lhr';
const superAdmin = makeActor({ userId: 'sa', roles: ['SUPER_ADMIN'] });
const branchAdmin = makeActor({ userId: 'ba', roles: ['BRANCH_ADMIN'], branchIds: [KHI] });
const staff = makeActor({ userId: 'st', roles: ['STAFF'], branchIds: [KHI] });

describe('canGrantRole', () => {
  it('Super Admin can grant any staff role, with correct branch rules', () => {
    expect(canGrantRole(superAdmin, 'BRANCH_ADMIN', LHR)).toBe(true);
    expect(canGrantRole(superAdmin, 'SUPER_ADMIN', null)).toBe(true);
    expect(canGrantRole(superAdmin, 'SUPER_ADMIN', KHI)).toMatch(/not tied to a branch/);
    expect(canGrantRole(superAdmin, 'STAFF', null)).toMatch(/Choose the branch/);
    expect(canGrantRole(superAdmin, 'EMPLOYER', null)).toMatch(/Only staff roles/);
    expect(canGrantRole(superAdmin, 'APPLICANT', null)).toMatch(/Only staff roles/);
  });

  it('Branch Admin can add Verifiers and Staff in their own branch only', () => {
    expect(canGrantRole(branchAdmin, 'STAFF', KHI)).toBe(true);
    expect(canGrantRole(branchAdmin, 'VERIFIER', KHI)).toBe(true);
    expect(canGrantRole(branchAdmin, 'STAFF', LHR)).toMatch(/own branch/);
    expect(canGrantRole(branchAdmin, 'BRANCH_ADMIN', KHI)).toMatch(/Only a Super Admin/);
    expect(canGrantRole(branchAdmin, 'SUPER_ADMIN', null)).toMatch(/Only a Super Admin/);
  });

  it('Super Admin and Branch Admin can grant Interviewer and Scheduler in a branch', () => {
    expect(canGrantRole(superAdmin, 'INTERVIEWER_SCHEDULER', KHI)).toBe(true);
    expect(canGrantRole(superAdmin, 'INTERVIEWER_SCHEDULER', null)).toMatch(/Choose the branch/);
    expect(canGrantRole(branchAdmin, 'INTERVIEWER_SCHEDULER', KHI)).toBe(true);
    expect(canGrantRole(branchAdmin, 'INTERVIEWER_SCHEDULER', LHR)).toMatch(/own branch/);
  });

  it('staff cannot manage accounts at all', () => {
    expect(canGrantRole(staff, 'STAFF', KHI)).toMatch(/cannot manage/);
  });
});

describe('canSeeUser / canManageUser', () => {
  const khiStaff = [{ role: 'STAFF' as const, branchId: KHI }];
  const khiAdmin = [{ role: 'BRANCH_ADMIN' as const, branchId: KHI }];
  const mixed = [
    { role: 'STAFF' as const, branchId: KHI },
    { role: 'STAFF' as const, branchId: LHR },
  ];
  const lhrStaff = [{ role: 'STAFF' as const, branchId: LHR }];

  it('Branch Admin sees anyone with a role in their branch, but manages only fully-local Verifiers/Staff', () => {
    expect(canSeeUser(branchAdmin, khiStaff)).toBe(true);
    expect(canSeeUser(branchAdmin, khiAdmin)).toBe(true);
    expect(canSeeUser(branchAdmin, lhrStaff)).toBe(false);
    expect(canManageUser(branchAdmin, 'x', khiStaff)).toBe(true);
    expect(canManageUser(branchAdmin, 'x', khiAdmin)).toMatch(/Only a Super Admin/);
    expect(canManageUser(branchAdmin, 'x', mixed)).toMatch(/Only a Super Admin/);
  });

  it('nobody manages their own account here; Super Admin manages everyone else', () => {
    expect(canManageUser(superAdmin, 'sa', [{ role: 'SUPER_ADMIN', branchId: null }])).toMatch(
      /your own account/,
    );
    expect(canManageUser(superAdmin, 'other', mixed)).toBe(true);
    expect(canManageUser(branchAdmin, 'ba', khiAdmin)).toMatch(/your own account/);
  });
});
