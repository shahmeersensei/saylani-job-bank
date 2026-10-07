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
  'company:register': 'Register and edit own company',
  'company:verify': 'Verify, reject or request info for companies',
  'company:suspend': 'Suspend or reinstate verified companies',
  'company:manage': 'Correct locked company details, transfer companies, assign verifiers',

  'applicant:read': 'View applicant profiles',
  'applicant:self': 'Manage own applicant profile',
  'applicant:verify_identity': 'Verify applicant identity documents',
  'applicant:manage': 'Correct applicant records, change phone numbers, deactivate profiles',
  'applicant:transfer': 'Move an applicant to another branch',

  'job:read': 'View jobs',
  'job:manage': 'Post and manage jobs for branch companies',
  'job:manage_own': "Post and manage own company's jobs",

  'match_case:read': 'View match cases',
  'match_case:manage': 'Create, review and progress match cases',
  'match_case:refer': 'Refer eligible candidates to employers',

  'interview:schedule_jobbank': 'Schedule and record Job Bank interviews',
  'interview:schedule_employer': 'Schedule and record employer interviews',

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
    'company:manage',
    'applicant:read',
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
    'company:manage',
    'company:suspend',
    'applicant:read',
    'applicant:manage',
    'applicant:transfer',
    'job:read',
    'job:manage',
    'match_case:read',
    'blacklist:request',
    'blacklist:decide',
    'audit:read',
    'report:read',
  ],
  VERIFIER: ['branch:read', 'company:read', 'company:verify', 'blacklist:request'],
  STAFF: [
    'branch:read',
    'company:read',
    'applicant:read',
    'applicant:verify_identity',
    'applicant:manage',
    'job:read',
    'match_case:read',
    'match_case:manage',
    'match_case:refer',
    'interview:schedule_jobbank',
    'placement:manage',
    'blacklist:request',
  ],
  EMPLOYER: [
    'company:register',
    'job:read',
    'job:manage_own',
    'match_case:read',
    'interview:schedule_employer',
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
  EMPLOYER: '/employer',
  APPLICANT: '/applicant',
};

export const ROLE_PRIORITY: readonly Role[] = [
  'SUPER_ADMIN',
  'BRANCH_ADMIN',
  'VERIFIER',
  'STAFF',
  'EMPLOYER',
  'APPLICANT',
];

export function homePathFor(roles: readonly Role[]): string {
  const primary = ROLE_PRIORITY.find((role) => roles.includes(role));
  return primary ? ROLE_HOME[primary] : '/';
}
