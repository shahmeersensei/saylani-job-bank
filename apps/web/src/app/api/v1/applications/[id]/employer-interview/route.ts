import { z } from 'zod';
import {
  scheduleEmployerInterview,
  scheduleEmployerInterviewSchema,
  updateEmployerInterviewStatus,
  updateEmployerInterviewStatusSchema,
} from '@/domains/placement';
import { apiHandler, ok, created } from '@/domains/shared/http';

const params = z.object({ id: z.uuid() });

/** POST /api/v1/applications/{id}/employer-interview — employer schedules an interview. */
export const POST = apiHandler({
  permission: 'interview:schedule_employer',
  params,
  body: scheduleEmployerInterviewSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    created(await scheduleEmployerInterview({ ...ctx, actor: actor! }, p.id, body)),
});

/** PATCH /api/v1/applications/{id}/employer-interview — employer updates interview status. */
export const PATCH = apiHandler({
  permission: 'interview:schedule_employer',
  params,
  body: updateEmployerInterviewStatusSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    ok(await updateEmployerInterviewStatus({ ...ctx, actor: actor! }, p.id, body)),
});
