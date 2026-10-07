import { requireRole } from '@/domains/auth';
import { listCompanies } from '@/domains/company';
import { listMasterData } from '@/domains/settings';
import { StaffPostJobForm } from './_components/StaffPostJobForm';

export const metadata = { title: 'Post a job' };

export default async function BranchAdminPostJobPage() {
  const { actor } = await requireRole('BRANCH_ADMIN');
  const [{ items: companies }, categories] = await Promise.all([
    listCompanies(actor, {
      page: 1,
      pageSize: 200,
      limit: 200,
      offset: 0,
      sort: { field: 'legalName', direction: 'asc' },
      q: undefined,
      filters: { status: 'VERIFIED' },
    }),
    listMasterData(actor, { type: 'JOB_CATEGORY' }),
  ]);

  return (
    <div className="grid w-full gap-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold">Post a job</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Create a job posting for a verified company in your branch.
        </p>
      </header>
      <StaffPostJobForm
        companies={companies.map((c) => ({ id: c.id, name: c.legalName }))}
        categories={categories.map((c) => ({ code: c.code, label: c.label }))}
      />
    </div>
  );
}
