import { markAllNotificationsRead } from '@/domains/notifications';
import { apiHandler, ok } from '@/domains/shared/http';

/** POST /api/v1/notifications/read-all — mark every unread notification as read. */
export const POST = apiHandler({
  handler: async ({ actor }) => ok(await markAllNotificationsRead(actor!)),
});
