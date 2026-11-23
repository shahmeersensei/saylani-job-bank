/** PRD §4 user roles. Permissions per role are seeded in M3. */
export const ROLES = [
  'SUPER_ADMIN',
  'BRANCH_ADMIN',
  'VERIFIER',
  'INTERVIEWER_SCHEDULER',
  'STAFF',
  'EMPLOYER',
  'APPLICANT',
] as const;

export type Role = (typeof ROLES)[number];

/** Roles whose authority is limited to the branch(es) they are assigned to. */
export const BRANCH_SCOPED_ROLES: readonly Role[] = [
  'BRANCH_ADMIN',
  'VERIFIER',
  'INTERVIEWER_SCHEDULER',
  'STAFF',
];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  BRANCH_ADMIN: 'Branch Admin',
  VERIFIER: 'Verification Officer',
  INTERVIEWER_SCHEDULER: 'Interviewer and Scheduler',
  STAFF: 'Job Bank Staff',
  EMPLOYER: 'Employer',
  APPLICANT: 'Applicant',
};

/** Must enrol an authenticator app before using the system (decided in M4, extended to Staff and Employer 2026-11-15, and to Verifier and Interviewer-Scheduler 2026-11-23: every password sign-in is now TOTP-protected, so the emailed employer sign-in code — which would bypass it — is retired). Applicants are the only exception: they sign in with a phone SMS code, never a password. */
export const TWO_FACTOR_REQUIRED_ROLES: readonly Role[] = [
  'SUPER_ADMIN',
  'BRANCH_ADMIN',
  'VERIFIER',
  'INTERVIEWER_SCHEDULER',
  'STAFF',
  'EMPLOYER',
];

/** Roles that manage staff accounts and can be invited (applicants/employers self-register). */
export const INTERNAL_ROLES: readonly Role[] = [
  'SUPER_ADMIN',
  'BRANCH_ADMIN',
  'VERIFIER',
  'INTERVIEWER_SCHEDULER',
  'STAFF',
];
