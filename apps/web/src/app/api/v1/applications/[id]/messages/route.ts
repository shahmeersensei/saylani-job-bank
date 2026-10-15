import { z } from 'zod';
import { listMessages, sendMessage } from '@/domains/placement';
import { apiHandler, ok, created } from '@/domains/shared/http';

const params = z.object({ id: z.uuid() });

const sendMessageBody = z.object({
  content: z.string().trim().min(1).max(2000),
});

/** GET /api/v1/applications/{id}/messages — list messages for an application. */
export const GET = apiHandler({
  params,
  handler: async ({ actor, params: p }) => ok(await listMessages(actor!, p.id)),
});

/** POST /api/v1/applications/{id}/messages — send a message. */
export const POST = apiHandler({
  params,
  body: sendMessageBody,
  handler: async ({ ctx, actor, params: p, body }) =>
    created(await sendMessage({ ...ctx, actor: actor! }, p.id, body.content)),
});
