import { z } from 'zod';
import {
  deleteStaff,
  deleteStaffSchema,
  getStaffMember,
  staffProfileSchema,
  updateStaffProfile,
} from '@/domains/user';
import { apiHandler, noContent, ok } from '@/domains/shared/http';

const params = z.object({ id: z.uuid() });

export const GET = apiHandler({
  permission: 'user:read',
  params,
  handler: async ({ actor, params: p }) => ok(await getStaffMember(actor!, p.id)),
});

export const PATCH = apiHandler({
  permission: 'user:manage',
  params,
  body: staffProfileSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    ok(await updateStaffProfile({ ...ctx, actor: actor! }, p.id, body)),
});

export const DELETE = apiHandler({
  permission: 'user:manage',
  params,
  body: deleteStaffSchema,
  handler: async ({ ctx, actor, params: p, body }) => {
    await deleteStaff({ ...ctx, actor: actor! }, p.id, body.reason);
    return noContent();
  },
});
