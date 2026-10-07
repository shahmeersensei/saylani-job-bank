import { z } from 'zod';
import {
  COMPANY_SORTABLE,
  companyFilters,
  listCompanies,
  staffRegisterCompany,
} from '@/domains/company';
import { apiHandler, created, ok } from '@/domains/shared/http';
import { parseListQuery } from '@/domains/shared/pagination';
import { registerCompanySchema } from '@jobbank/shared';

/** GET /api/v1/companies — branch-scoped company list (Branch Admin: verified only; Super Admin: all). */
export const GET = apiHandler({
  permission: 'company:read',
  handler: async ({ actor, request }) => {
    const query = parseListQuery(new URL(request.url).searchParams, {
      sortable: [...COMPANY_SORTABLE],
      defaultSort: { field: 'legalName', direction: 'asc' },
      filters: companyFilters,
    });
    return ok(await listCompanies(actor!, query));
  },
});

/** POST /api/v1/companies — Branch Admin / Super Admin registers a company for their branch. */
export const POST = apiHandler({
  permission: 'company:manage',
  body: registerCompanySchema.extend({ branchId: z.uuid() }),
  handler: async ({ ctx, actor, body }) => {
    const company = await staffRegisterCompany({ ...ctx, actor: actor! }, body);
    return created(company);
  },
});
