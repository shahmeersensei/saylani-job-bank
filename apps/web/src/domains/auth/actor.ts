import 'server-only';
import { permissionsFor, TWO_FACTOR_REQUIRED_ROLES, type Role } from '@jobbank/shared';
import { schema } from '@jobbank/db';
import { and, eq } from 'drizzle-orm';
import type { Actor } from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { getAuth, isPlaceholderEmail } from './auth';

export const ACTIVE_BRANCH_COOKIE = 'jb-active-branch';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SessionUser {
  id: string;
  name: string;
  /** null for applicants who only have a phone number. */
  email: string | null;
  phoneNumber: string | null;
  title: string | null;
  twoFactorEnabled: boolean;
}

export type AuthState =
  | { status: 'anonymous' }
  | { status: 'blocked'; reason: 'DISABLED' | 'INVITED'; user: SessionUser }
  | { status: 'active'; user: SessionUser; actor: Actor };

function readCookie(headers: Headers, name: string): string | undefined {
  const raw = headers.get('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function requiresTwoFactor(roles: readonly Role[]): boolean {
  return roles.some((role) => TWO_FACTOR_REQUIRED_ROLES.includes(role));
}

/** Builds the Actor (roles, permissions, branch scope, 2FA state) for a user. */
export async function loadActor(userId: string, requestedActiveBranch?: string): Promise<Actor> {
  const [assignments, [user]] = await Promise.all([
    db
      .select({ role: schema.userRoles.roleCode, branchId: schema.userRoles.branchId })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId)),
    db
      .select({ twoFactorEnabled: schema.users.twoFactorEnabled })
      .from(schema.users)
      .where(eq(schema.users.id, userId)),
  ]);

  const roles = [...new Set(assignments.map((a) => a.role as Role))];
  const [[applicant], [membership]] = await Promise.all([
    roles.includes('APPLICANT')
      ? db
          .select({ id: schema.applicants.id })
          .from(schema.applicants)
          .where(eq(schema.applicants.userId, userId))
      : [],
    roles.includes('EMPLOYER')
      ? db
          .select({ companyId: schema.companyMembers.companyId })
          .from(schema.companyMembers)
          .where(eq(schema.companyMembers.userId, userId))
      : [],
  ]);
  const branchIds = [
    ...new Set(assignments.map((a) => a.branchId).filter((id): id is string => id !== null)),
  ];

  let activeBranchId: string | null = null;
  if (roles.includes('SUPER_ADMIN') && requestedActiveBranch && UUID.test(requestedActiveBranch)) {
    const [branch] = await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(
        and(eq(schema.branches.id, requestedActiveBranch), eq(schema.branches.isActive, true)),
      );
    activeBranchId = branch?.id ?? null;
  }

  return {
    userId,
    roles,
    permissions: permissionsFor(roles),
    branchIds,
    activeBranchId,
    companyId: membership?.companyId ?? null,
    applicantId: applicant?.id ?? null,
    twoFactorPending: requiresTwoFactor(roles) && !user?.twoFactorEnabled,
  };
}

/** Resolves the session cookie in `headers` into the caller's auth state. */
export async function getAuthState(headers: Headers): Promise<AuthState> {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return { status: 'anonymous' };

  const [row] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      phoneNumber: schema.users.phoneNumber,
      title: schema.users.title,
      twoFactorEnabled: schema.users.twoFactorEnabled,
      status: schema.users.status,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id));
  if (!row) return { status: 'anonymous' };

  const user: SessionUser = {
    id: row.id,
    name: row.name,
    email: isPlaceholderEmail(row.email) ? null : row.email,
    phoneNumber: row.phoneNumber,
    title: row.title,
    twoFactorEnabled: row.twoFactorEnabled,
  };
  if (row.status !== 'ACTIVE') return { status: 'blocked', reason: row.status, user };

  const actor = await loadActor(row.id, readCookie(headers, ACTIVE_BRANCH_COOKIE));
  return { status: 'active', user, actor };
}
