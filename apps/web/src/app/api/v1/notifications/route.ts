import { z } from 'zod';
import { listMyNotifications } from '@/domains/notifications';
import { apiHandler, ok } from '@/domains/shared/http';

/** GET /api/v1/notifications?page&pageSize — the signed-in user's own notifications. */
export const GET = apiHandler({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(8),
  }),
  handler: async ({ actor, query }) => {
    const result = await listMyNotifications(actor!, query);
    return ok(result.items, {
      page: query.page,
      pageSize: query.pageSize,
      total: result.total,
      pageCount: Math.ceil(result.total / query.pageSize),
    });
  },
});
