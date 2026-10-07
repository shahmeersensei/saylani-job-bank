import { z } from 'zod';
import { myCompanyBranchOptions } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';

/** GET /api/v1/companies/me/branch-options?lat&lng — branches sorted by proximity. */
export const GET = apiHandler({
  permission: 'company:register',
  query: z.object({ lat: z.coerce.number(), lng: z.coerce.number() }),
  handler: async ({ actor, query }) =>
    ok(await myCompanyBranchOptions(actor!, { lat: query.lat, lng: query.lng })),
});
