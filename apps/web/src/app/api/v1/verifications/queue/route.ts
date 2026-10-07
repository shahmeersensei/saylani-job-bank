import { QUEUE_SORTABLE, listQueue, queueFilters } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { parseListQuery } from '@/domains/shared/pagination';

/** GET /api/v1/verifications/queue — branch-scoped verifier queue sorted by SLA urgency. */
export const GET = apiHandler({
  permission: 'company:verify',
  handler: async ({ actor, request }) => {
    const query = parseListQuery(new URL(request.url).searchParams, {
      sortable: [...QUEUE_SORTABLE],
      defaultSort: { field: 'slaDueOn', direction: 'asc' },
      filters: queueFilters,
    });
    return ok(await listQueue(actor!, query));
  },
});
