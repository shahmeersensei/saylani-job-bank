import 'server-only';
import { INTERNAL_ROLES, ROLES, type Role } from '@jobbank/shared';
import { schema } from '@jobbank/db';
import { and, asc, count, eq, exists, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  INVITE_TTL_DAYS,
  issueAccountToken,
  pendingInvitation,
  sendInvitationEmail,
} from '@/domains/auth';
import { runCommand, type RequestContext } from '@/domains/shared/audit';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ScopeViolationError,
  ValidationError,
} from '@/domains/shared/errors';
import { paginationMeta, type ListQuery } from '@/domains/shared/pagination';
import { isSuperAdmin, type Actor } from '@/domains/shared/scope';
import { db, type DbExecutor } from '@/lib/db';
import { logger } from '@/lib/logger';
import { canGrantRole, canManageUser, canSeeUser } from './policy';

type SignedIn = RequestContext & { actor: Actor };

const u = schema.users;
const ur = schema.userRoles;

export const STAFF_SORTABLE = ['name', 'createdAt', 'lastLoginAt'] as const;
export const staffFilters = {
  role: z.enum(INTERNAL_ROLES as [Role, ...Role[]]).optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'INVITED']).optional(),
  branchId: z.uuid().optional(),
};

export const inviteStaffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase().max(254),
  title: z.string().trim().max(80).nullable().optional(),
  role: z.enum(ROLES),
  branchId: z.uuid().nullable(),
});

export const roleAssignmentSchema = z.object({
  role: z.enum(ROLES),
  branchId: z.uuid().nullable(),
});
export const statusChangeSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
  reason: z.string().trim().min(5, 'Give a short reason (at least 5 characters)').max(500),
});
export const deleteStaffSchema = z.object({
  reason: z.string().trim().min(5, 'Give a short reason (at least 5 characters)').max(500),
});
export const staffProfileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  title: z.string().trim().max(80).nullable().optional(),
});

export interface RoleAssignmentView {
  id: string;
  role: Role;
  branchId: string | null;
  branchName: string | null;
}

export interface StaffListItem {
  id: string;
  name: string;
  email: string;
  title: string | null;
  status: 'ACTIVE' | 'DISABLED' | 'INVITED';
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  roles: RoleAssignmentView[];
}

export interface StaffDetail extends StaffListItem {
  createdAt: string;
  invitationExpiresAt: string | null;
  /** What the signed-in actor may do with this account (drives the UI). */
  can: { manage: boolean; reason: string | null; grantableRoles: Role[] };
}

/** Assignments are visible to the actor: everything for Super Admin, own branches for others. */
function assignmentScope(actor: Actor): SQL | undefined {
  if (isSuperAdmin(actor))
    return actor.activeBranchId ? eq(ur.branchId, actor.activeBranchId) : undefined;
  return actor.branchIds.length ? inArray(ur.branchId, [...actor.branchIds]) : sql`false`;
}

async function assignmentsFor(
  executor: DbExecutor,
  userIds: string[],
): Promise<Map<string, RoleAssignmentView[]>> {
  const map = new Map<string, RoleAssignmentView[]>();
  if (userIds.length === 0) return map;
  const rows = await executor
    .select({
      id: ur.id,
      userId: ur.userId,
      role: ur.roleCode,
      branchId: ur.branchId,
      branchName: schema.branches.name,
    })
    .from(ur)
    .leftJoin(schema.branches, eq(schema.branches.id, ur.branchId))
    .where(inArray(ur.userId, userIds))
    .orderBy(asc(ur.createdAt));
  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push({
      id: row.id,
      role: row.role as Role,
      branchId: row.branchId,
      branchName: row.branchName,
    });
    map.set(row.userId, list);
  }
  return map;
}

function toListItem(row: typeof u.$inferSelect, roles: RoleAssignmentView[]): StaffListItem {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    title: row.title,
    status: row.status,
    twoFactorEnabled: row.twoFactorEnabled,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    roles,
  };
}

// ─── Reads ─────────────────────────────────────────────────────────────

export async function listStaff(
  actor: Actor,
  query: ListQuery<
    (typeof STAFF_SORTABLE)[number],
    { role?: Role; status?: StaffListItem['status']; branchId?: string }
  >,
) {
  if (!actor.permissions.has('user:read')) throw new ForbiddenError();
  const { role, status, branchId } = query.filters;
  if (branchId && !isSuperAdmin(actor) && !actor.branchIds.includes(branchId)) {
    throw new ScopeViolationError(undefined, {
      entityType: 'branch',
      entityId: branchId,
      branchId,
    });
  }

  const membership = exists(
    db
      .select({ one: sql`1` })
      .from(ur)
      .where(
        and(
          eq(ur.userId, u.id),
          inArray(ur.roleCode, [...INTERNAL_ROLES]),
          assignmentScope(actor),
          role ? eq(ur.roleCode, role) : undefined,
          branchId ? eq(ur.branchId, branchId) : undefined,
        ),
      ),
  );
  const where = and(
    membership,
    status ? eq(u.status, status) : undefined,
    query.q ? or(ilike(u.name, `%${query.q}%`), ilike(u.email, `%${query.q}%`)) : undefined,
  );

  const sortColumn = { name: u.name, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt }[
    query.sort.field
  ];
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(u)
      .where(where)
      .orderBy(
        query.sort.direction === 'asc'
          ? sql`${sortColumn} asc nulls last`
          : sql`${sortColumn} desc nulls last`,
        asc(u.id),
      )
      .limit(query.limit)
      .offset(query.offset),
    db.select({ value: count() }).from(u).where(where),
  ]);
  const roles = await assignmentsFor(
    db,
    rows.map((r) => r.id),
  );
  return {
    data: rows.map((row) => toListItem(row, roles.get(row.id) ?? [])),
    meta: paginationMeta(query, total?.value ?? 0),
  };
}

function grantableRolesFor(actor: Actor): Role[] {
  return INTERNAL_ROLES.filter((role) => {
    if (role === 'SUPER_ADMIN') return canGrantRole(actor, role, null) === true;
    return (
      isSuperAdmin(actor) || actor.branchIds.some((b) => canGrantRole(actor, role, b) === true)
    );
  });
}

async function loadTarget(executor: DbExecutor, actor: Actor, userId: string) {
  const [row] = await executor.select().from(u).where(eq(u.id, userId));
  const assignments = (await assignmentsFor(executor, [userId])).get(userId) ?? [];
  const internal = assignments.filter((a) => INTERNAL_ROLES.includes(a.role));
  if (!row || internal.length === 0) throw new NotFoundError('Staff member', userId);
  if (!canSeeUser(actor, internal)) {
    throw new ScopeViolationError(undefined, {
      entityType: 'user',
      entityId: userId,
      branchId: internal[0]?.branchId ?? null,
    });
  }
  return { row, assignments: internal };
}

export async function getStaffMember(actor: Actor, userId: string): Promise<StaffDetail> {
  const { row, assignments } = await loadTarget(db, actor, userId);
  const manage = canManageUser(actor, userId, assignments);
  const invitation = row.status === 'INVITED' ? await pendingInvitation(userId) : null;
  return {
    ...toListItem(row, assignments),
    createdAt: row.createdAt.toISOString(),
    invitationExpiresAt: invitation?.expiresAt.toISOString() ?? null,
    can: {
      manage: manage === true,
      reason: manage === true ? null : manage,
      grantableRoles: grantableRolesFor(actor),
    },
  };
}

// ─── Writes ────────────────────────────────────────────────────────────

function assertAllowed(result: true | string): void {
  if (result !== true) throw new ForbiddenError(result);
}

async function assertNotLastSuperAdmin(executor: DbExecutor, userId: string): Promise<void> {
  const [row] = await executor
    .select({ others: count() })
    .from(ur)
    .innerJoin(u, eq(u.id, ur.userId))
    .where(and(eq(ur.roleCode, 'SUPER_ADMIN'), eq(u.status, 'ACTIVE'), ne(ur.userId, userId)));
  if ((row?.others ?? 0) === 0) {
    throw new ConflictError('At least one active Super Admin must remain');
  }
}

async function branchName(executor: DbExecutor, branchId: string | null): Promise<string | null> {
  if (!branchId) return null;
  const [row] = await executor
    .select({ name: schema.branches.name, active: schema.branches.isActive })
    .from(schema.branches)
    .where(eq(schema.branches.id, branchId));
  if (!row) throw new ValidationError([{ path: 'branchId', message: 'Branch not found' }]);
  if (!row.active)
    throw new ValidationError([{ path: 'branchId', message: 'This branch is inactive' }]);
  return row.name;
}

async function actorName(executor: DbExecutor, actor: Actor): Promise<string> {
  const [row] = await executor.select({ name: u.name }).from(u).where(eq(u.id, actor.userId));
  return row?.name ?? 'Saylani Job Bank';
}

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

/** Creates an INVITED account with one role and emails a set-password link. */
export async function inviteStaff(
  ctx: SignedIn,
  input: InviteStaffInput,
): Promise<{ user: StaffDetail; emailSent: boolean }> {
  assertAllowed(canGrantRole(ctx.actor, input.role, input.branchId));

  const invited = await runCommand(ctx, async ({ tx, audit }) => {
    const [existing] = await tx
      .select({ id: u.id })
      .from(u)
      .where(eq(sql`lower(${u.email})`, input.email));
    if (existing) {
      throw new ConflictError(
        'An account with this email already exists. Open it and add a role instead.',
      );
    }
    const branch = await branchName(tx, input.branchId);
    const [user] = await tx
      .insert(u)
      .values({
        name: input.name,
        email: input.email,
        title: input.title ?? null,
        status: 'INVITED',
      })
      .returning();
    await tx.insert(ur).values({
      userId: user!.id,
      roleCode: input.role,
      branchId: input.branchId,
      grantedBy: ctx.actor.userId,
    });
    const token = await issueAccountToken(tx, {
      userId: user!.id,
      purpose: 'INVITE',
      ttlSeconds: INVITE_TTL_DAYS * 24 * 60 * 60,
      createdBy: ctx.actor.userId,
    });
    audit({
      action: 'user.invite',
      entityType: 'user',
      entityId: user!.id,
      branchId: input.branchId,
      after: {
        name: input.name,
        email: input.email,
        title: input.title ?? null,
        role: input.role,
        branchId: input.branchId,
      },
    });
    return { user: user!, token, branch, inviter: await actorName(tx, ctx.actor) };
  });

  let emailSent = true;
  try {
    await sendInvitationEmail({
      user: invited.user,
      token: invited.token,
      invitedByName: invited.inviter,
      role: input.role,
      branchName: invited.branch,
    });
  } catch (err) {
    emailSent = false;
    logger.warn('invitation email failed; it can be resent from the user page', {
      userId: invited.user.id,
      err,
    });
  }
  return { user: await getStaffMember(ctx.actor, invited.user.id), emailSent };
}

export async function resendInvitation(
  ctx: SignedIn,
  userId: string,
): Promise<{ emailSent: boolean }> {
  const result = await runCommand(ctx, async ({ tx, audit }) => {
    const { row, assignments } = await loadTarget(tx, ctx.actor, userId);
    assertAllowed(canManageUser(ctx.actor, userId, assignments));
    if (row.status !== 'INVITED')
      throw new ConflictError('This person has already activated their account');
    const token = await issueAccountToken(tx, {
      userId,
      purpose: 'INVITE',
      ttlSeconds: INVITE_TTL_DAYS * 24 * 60 * 60,
      createdBy: ctx.actor.userId,
    });
    audit({
      action: 'user.invite_resend',
      entityType: 'user',
      entityId: userId,
      branchId: assignments[0]?.branchId ?? null,
    });
    return { row, token, first: assignments[0]!, inviter: await actorName(tx, ctx.actor) };
  });
  try {
    await sendInvitationEmail({
      user: result.row,
      token: result.token,
      invitedByName: result.inviter,
      role: result.first.role,
      branchName: result.first.branchName,
    });
    return { emailSent: true };
  } catch {
    return { emailSent: false };
  }
}

export async function grantRole(
  ctx: SignedIn,
  userId: string,
  input: z.infer<typeof roleAssignmentSchema>,
): Promise<StaffDetail> {
  assertAllowed(canGrantRole(ctx.actor, input.role, input.branchId));
  if (userId === ctx.actor.userId) throw new ForbiddenError('You cannot change your own roles');
  await runCommand(ctx, async ({ tx, audit }) => {
    await loadTarget(tx, ctx.actor, userId);
    await branchName(tx, input.branchId);
    const inserted = await tx
      .insert(ur)
      .values({
        userId,
        roleCode: input.role,
        branchId: input.branchId,
        grantedBy: ctx.actor.userId,
      })
      .onConflictDoNothing()
      .returning({ id: ur.id });
    if (inserted.length === 0) throw new ConflictError('This person already has that role');
    audit({
      action: 'user.role_grant',
      entityType: 'user',
      entityId: userId,
      branchId: input.branchId,
      after: input,
    });
  });
  return getStaffMember(ctx.actor, userId);
}

export async function revokeRole(
  ctx: SignedIn,
  userId: string,
  assignmentId: string,
): Promise<StaffDetail> {
  if (userId === ctx.actor.userId) throw new ForbiddenError('You cannot change your own roles');
  await runCommand(ctx, async ({ tx, audit }) => {
    const { assignments } = await loadTarget(tx, ctx.actor, userId);
    const assignment = assignments.find((a) => a.id === assignmentId);
    if (!assignment) throw new NotFoundError('Role assignment', assignmentId);
    assertAllowed(canGrantRole(ctx.actor, assignment.role, assignment.branchId));
    if (assignments.length === 1) {
      throw new ConflictError(
        'This is their only role. Disable the account instead of removing it.',
      );
    }
    if (assignment.role === 'SUPER_ADMIN') await assertNotLastSuperAdmin(tx, userId);
    await tx.delete(ur).where(eq(ur.id, assignmentId));
    audit({
      action: 'user.role_revoke',
      entityType: 'user',
      entityId: userId,
      branchId: assignment.branchId,
      before: { role: assignment.role, branchId: assignment.branchId },
    });
  });
  return getStaffMember(ctx.actor, userId);
}

/** Disable (signs them out everywhere) or re-enable a staff account. Reason is required. */
export async function setStaffStatus(
  ctx: SignedIn,
  userId: string,
  input: z.infer<typeof statusChangeSchema>,
): Promise<StaffDetail> {
  await runCommand(ctx, async ({ tx, audit }) => {
    const { row, assignments } = await loadTarget(tx, ctx.actor, userId);
    assertAllowed(canManageUser(ctx.actor, userId, assignments));
    if (row.status === 'INVITED')
      throw new ConflictError('Invited accounts activate through their invitation link');
    if (row.status === input.status) return;
    if (input.status === 'DISABLED' && assignments.some((a) => a.role === 'SUPER_ADMIN')) {
      await assertNotLastSuperAdmin(tx, userId);
    }
    await tx.update(u).set({ status: input.status }).where(eq(u.id, userId));
    if (input.status === 'DISABLED')
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    audit({
      action: input.status === 'DISABLED' ? 'user.disable' : 'user.enable',
      entityType: 'user',
      entityId: userId,
      branchId: assignments[0]?.branchId ?? null,
      before: { status: row.status },
      after: { status: input.status },
      reason: input.reason,
    });
  });
  return getStaffMember(ctx.actor, userId);
}

export async function updateStaffProfile(
  ctx: SignedIn,
  userId: string,
  input: z.infer<typeof staffProfileSchema>,
): Promise<StaffDetail> {
  await runCommand(ctx, async ({ tx, audit }) => {
    const { row, assignments } = await loadTarget(tx, ctx.actor, userId);
    assertAllowed(canManageUser(ctx.actor, userId, assignments));
    const changes = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (Object.keys(changes).length === 0) return;
    await tx.update(u).set(changes).where(eq(u.id, userId));
    audit({
      action: 'user.update',
      entityType: 'user',
      entityId: userId,
      branchId: assignments[0]?.branchId ?? null,
      before: { name: row.name, title: row.title },
      after: changes,
    });
  });
  return getStaffMember(ctx.actor, userId);
}

/** Permanently delete a staff account. Requires a reason; prevents deleting the last Super Admin. */
export async function deleteStaff(ctx: SignedIn, userId: string, reason: string): Promise<void> {
  await runCommand(ctx, async ({ tx, audit }) => {
    const { row, assignments } = await loadTarget(tx, ctx.actor, userId);
    assertAllowed(canManageUser(ctx.actor, userId, assignments));
    if (assignments.some((a) => a.role === 'SUPER_ADMIN')) {
      await assertNotLastSuperAdmin(tx, userId);
    }
    audit({
      action: 'user.delete',
      entityType: 'user',
      entityId: userId,
      branchId: assignments[0]?.branchId ?? null,
      before: { name: row.name, email: row.email, status: row.status },
      after: null,
      reason,
    });
    await tx.delete(u).where(eq(u.id, userId));
  });
}

/** For a lost phone: removes their authenticator so they enrol again at next sign-in. */
export async function resetStaffTwoFactor(
  ctx: SignedIn,
  userId: string,
  reason: string,
): Promise<StaffDetail> {
  await runCommand(ctx, async ({ tx, audit }) => {
    const { row, assignments } = await loadTarget(tx, ctx.actor, userId);
    assertAllowed(canManageUser(ctx.actor, userId, assignments));
    if (!row.twoFactorEnabled)
      throw new ConflictError('Two-factor authentication is not set up for this account');
    await tx.delete(schema.twoFactors).where(eq(schema.twoFactors.userId, userId));
    await tx.update(u).set({ twoFactorEnabled: false }).where(eq(u.id, userId));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    audit({
      action: 'user.2fa_reset',
      entityType: 'user',
      entityId: userId,
      branchId: assignments[0]?.branchId ?? null,
      reason,
    });
  });
  return getStaffMember(ctx.actor, userId);
}
