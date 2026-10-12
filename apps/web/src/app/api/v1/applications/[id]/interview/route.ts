import { z } from 'zod';
import { scheduleInterview, scheduleInterviewSchema } from '@/domains/placement';
import { apiHandler, ok } from '@/domains/shared/http';

const params = z.object({ id: z.uuid() });

/** POST /api/v1/applications/{id}/interview — branch admin schedules an interview. */
export const POST = apiHandler({
  permission: 'interview:schedule_jobbank',
  params,
  body: scheduleInterviewSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    ok(await scheduleInterview({ ...ctx, actor: actor! }, p.id, body)),
});
