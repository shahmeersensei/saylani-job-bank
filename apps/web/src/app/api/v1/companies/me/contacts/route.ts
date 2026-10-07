import { companyContactsSchema } from '@jobbank/shared';
import { saveMyContacts } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';

/** PUT /api/v1/companies/me/contacts — replace the full contact list. */
export const PUT = apiHandler({
  permission: 'company:register',
  body: companyContactsSchema,
  handler: async ({ ctx, actor, body }) =>
    ok(await saveMyContacts({ ...ctx, actor: actor! }, body)),
});
