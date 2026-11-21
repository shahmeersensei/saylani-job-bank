import { ROLES } from '@jobbank/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { branches } from './branches';
import { users } from './identity';

/** Reference data, seeded from @jobbank/shared (ROLES, PERMISSIONS, ROLE_PERMISSIONS). */
export const roles = pgTable('roles', {
  code: text({ enum: ROLES }).primaryKey(),
  name: text().notNull(),
  isBranchScoped: boolean().notNull(),
});

export const permissions = pgTable('permissions', {
  code: text().primaryKey(),
  description: text().notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleCode: text({ enum: ROLES })
      .notNull()
      .references(() => roles.code, { onDelete: 'cascade' }),
    permissionCode: text()
      .notNull()
      .references(() => permissions.code, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleCode, t.permissionCode] })],
);

/**
 * A user's roles. Branch-scoped roles (Branch Admin, Verifier, Interviewer
 * and Scheduler, Staff) MUST name a branch; global/self-scoped roles (Super
 * Admin, Employer, Applicant) must NOT — enforced in SQL.
 */
export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleCode: text({ enum: ROLES })
      .notNull()
      .references(() => roles.code),
    branchId: uuid().references(() => branches.id, { onDelete: 'restrict' }),
    grantedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('user_roles_assignment_uq').on(t.userId, t.roleCode, t.branchId).nullsNotDistinct(),
    index('user_roles_user_idx').on(t.userId),
    index('user_roles_branch_idx').on(t.branchId, t.roleCode),
    check(
      'user_roles_branch_scope',
      sql`(${t.roleCode} in ('BRANCH_ADMIN', 'VERIFIER', 'INTERVIEWER_SCHEDULER', 'STAFF')) = (${t.branchId} is not null)`,
    ),
  ],
);
