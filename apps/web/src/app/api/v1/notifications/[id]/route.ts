import { z } from 'zod';
import { markNotificationRead } from '@/domains/notifications';
import { apiHandler, ok } from '@/domains/shared/http';

/** PATCH /api/v1/notifications/[id] — mark one notification as read (owner only). */
export const PATCH = apiHandler({
  params: z.object({ id: z.uuid() }),
  handler: async ({ actor, params }) => {
    await markNotificationRead(actor!, params.id);
    return ok({ read: true });
  },
});
