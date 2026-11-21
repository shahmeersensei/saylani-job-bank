import type { Role } from './roles';

/**
 * Permission catalogue (`resource:action`). Single source of truth: the database
 * `permissions` / `role_permissions` tables are seeded from this file, and runtime
 * checks read it directly. Ownership and branch scope are checked separately.
 */
export const PERMISSIONS = {
  'branch:read': 'View branches',
  'branch:manage': 'Create and edit branches',
  'scope:switch_branch': 'Switch the active branch (all-branch oversight)',
  'user:read': 'View users',
  'user:manage': 'Invite users, assign roles, deactivate accounts',
  'settings:manage': 'Change system and branch settings',
  'master_data:manage': 'Manage master data lists',

  'company:read': 'View companies',
  'company:register': 'Register own company and edit it while it is still un-verified',
  /** Field-visit onboarding: a staff member registers a company they approached. */
  'company:onboard': 'Register a company on behalf of an employer after a field visit',
  'company:verify': 'Verify, reject or request info for companies',
  'company:suspend': 'Suspend or reinstate verified companies',
  'company:manage': 'Correct locked company details, transfer companies, assign verifiers',

  'applicant:read': 'View applicant profiles',
  'applicant:create': 'Register applicants on behalf of job seekers',
  'applicant:self': 'Manage own applicant profile',
  'applicant:verify_identity': 'Verify applicant identity documents',
  'applicant:manage': 'Correct applicant records, change phone numbers, deactivate profiles',
  'applicant:transfer': 'Move an applicant to another branch',

  'job:read': 'View jobs',
  'job:manage': 'Post and manage jobs for branch companies',
  'job:manage_own': "Post and manage own company's jobs",
  /** Staff shares a job (vacancy) with a specific applicant. */
  'job:refer': 'Refer jobs to applicants',

  'match_case:read': 'View match cases',
  'match_case:manage': 'Create, review and progress match cases',
  'match_case:refer': 'Refer eligible candidates to employers',

  'interview:schedule_jobbank': 'Schedule and record Job Bank interviews',

  /** 0052 — record what happened in a scheduled Job Bank interview:
      attendance (Attended / No-show), result (Passed / Failed) and feedback. */
  'interview:record_outcome': 'Record a Job Bank interview outcome',

  'decision:employer': 'Hold / select / reject referred candidates',
  'decision:applicant': 'Accept / refuse / counteroffer own offers',
  'decision:proxy': 'Record a decision on behalf of an actor (off by default)',

  'placement:manage': 'Confirm placements and record follow-ups',

  'blacklist:request': 'Request a blacklist entry',
  'blacklist:decide': 'Approve or decline blacklist requests',
  'restriction:lift': 'Lift an active restriction',

  'audit:read': 'View audit logs',
  'report:read': 'View reports',
} as const satisfies Record<string, string>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** PRD §4 responsibilities → permissions. `decision:proxy` is deliberately unassigned. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: [
    'branch:read',
    'branch:manage',
    'scope:switch_branch',
    'user:read',
    'user:manage',
    'settings:manage',
    'master_data:manage',
    'company:read',
    'company:onboard',
    'company:manage',
    'company:suspend',
    'applicant:read',
    'applicant:create',
    'applicant:verify_identity',
    'applicant:manage',
    'applicant:transfer',
    'job:read',
    'match_case:read',
    'restriction:lift',
    'audit:read',
    'report:read',
  ],
  BRANCH_ADMIN: [
    'branch:read',
    'user:read',
    'user:manage',
    'settings:manage',
    'company:read',
    'company:onboard',
    'company:manage',
    'company:verify',
    'company:suspend',
    'applicant:read',
    'applicant:create',
    'applicant:verify_identity',
    'applicant:manage',
    'applicant:transfer',
    'job:read',
    'job:manage',
    'job:refer',
    'match_case:read',
    'match_case:manage',
    'match_case:refer',
    'interview:schedule_jobbank',
    'interview:record_outcome',
    'placement:manage',
    'blacklist:request',
    'blacklist:decide',
    'audit:read',
    'report:read',
  ],
  VERIFIER: [
    'branch:read',
    'company:read',
    'company:onboard',
    'company:manage',
    'job:read',
    'job:manage',
    'blacklist:request',
  ],
  STAFF: [
    'branch:read',
    'company:read',
    'applicant:read',
    'applicant:create',
    'applicant:verify_identity',
    'applicant:manage',
    'job:read',
    /** Staff post jobs for verified companies in their city scope (entry
        points workstream): staffCreateJob still enforces VERIFIED + scope. */
    'job:manage',
    'job:refer',
    'match_case:read',
    'match_case:manage',
    'match_case:refer',
    'interview:schedule_jobbank',
    'interview:record_outcome',
    'placement:manage',
    'blacklist:request',
  ],
  /** One combined role (2026-11-12), end-to-end for the Job Bank interview
      stage (Option B, 0052): schedules Job Bank interviews, records their
      outcomes, and refers candidates he passed to the employer. He still
      cannot shortlist (match_case:manage), manage jobs/companies/staff,
      or decide for employers — and his referral is pass-only, enforced in
      referApplicantToEmployer, not just by this list. */
  INTERVIEWER_SCHEDULER: [
    'branch:read',
    'applicant:read',
    'job:read',
    'match_case:read',
    'match_case:refer',
    'interview:schedule_jobbank',
    'interview:record_outcome',
  ],
  EMPLOYER: [
    'company:register',
    'job:read',
    'job:manage_own',
    'match_case:read',
    'decision:employer',
    'blacklist:request',
  ],
  APPLICANT: ['applicant:self', 'job:read', 'match_case:read', 'decision:applicant'],
};

export function permissionsFor(roles: readonly Role[]): ReadonlySet<Permission> {
  return new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]));
}

/** Where each role lands after signing in (first match in this order wins). */
export const ROLE_HOME: Record<Role, string> = {
  SUPER_ADMIN: '/super-admin',
  BRANCH_ADMIN: '/branch-admin',
  VERIFIER: '/verifier',
  STAFF: '/staff',
  INTERVIEWER_SCHEDULER: '/interviewer-scheduler',
  EMPLOYER: '/employer',
  APPLICANT: '/applicant',
};

export const ROLE_PRIORITY: readonly Role[] = [
  'SUPER_ADMIN',
  'BRANCH_ADMIN',
  'VERIFIER',
  'STAFF',
  'INTERVIEWER_SCHEDULER',
  'EMPLOYER',
  'APPLICANT',
];

export function homePathFor(roles: readonly Role[]): string {
  const primary = ROLE_PRIORITY.find((role) => roles.includes(role));
  return primary ? ROLE_HOME[primary] : '/';
}
