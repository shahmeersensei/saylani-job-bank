import { z } from 'zod';
import {
  scheduleInterview,
  scheduleInterviewSchema,
  updateInterviewStatus,
  updateInterviewStatusSchema,
} from '@/domains/placement';
import { apiHandler, ok, created } from '@/domains/shared/http';

const params = z.object({ id: z.uuid() });

/** POST /api/v1/applications/{id}/interview — staff/branch-admin schedules an interview. */
export const POST = apiHandler({
  permission: 'interview:schedule_jobbank',
  params,
  body: scheduleInterviewSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    created(await scheduleInterview({ ...ctx, actor: actor! }, p.id, body)),
});

/** PATCH /api/v1/applications/{id}/interview — staff/branch-admin updates interview status. */
export const PATCH = apiHandler({
  permission: 'interview:schedule_jobbank',
  params,
  body: updateInterviewStatusSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    ok(await updateInterviewStatus({ ...ctx, actor: actor! }, p.id, body)),
});
