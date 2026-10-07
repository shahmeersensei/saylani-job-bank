import { companySiteSchema } from '@jobbank/shared';
import { removeMySite, updateMySite } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { z } from 'zod';

const params = z.object({ siteId: z.uuid() });

/** PATCH /api/v1/companies/me/sites/{siteId} — update a work site. */
export const PATCH = apiHandler({
  permission: 'company:register',
  params,
  body: companySiteSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    ok(await updateMySite({ ...ctx, actor: actor! }, p.siteId, body)),
});

/** DELETE /api/v1/companies/me/sites/{siteId} — archive a work site. */
export const DELETE = apiHandler({
  permission: 'company:register',
  params,
  handler: async ({ ctx, actor, params: p }) =>
    ok(await removeMySite({ ...ctx, actor: actor! }, p.siteId)),
});
