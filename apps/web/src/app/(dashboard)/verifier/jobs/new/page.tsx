import { requireRole } from '@/domains/auth';
import { listCompanies } from '@/domains/company';
import { listMasterData } from '@/domains/settings';
import { StaffPostJobForm } from '../../../branch-admin/jobs/new/_components/StaffPostJobForm';

export const metadata = { title: 'Post a job' };

export default async function VerifierPostJobPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const [{ actor }, { companyId }] = await Promise.all([requireRole('VERIFIER'), searchParams]);
  // Only VERIFIED companies in the verifier's own branch(es), matching the server rule in
  // staffCreateJob. listCompanies alone is city-scoped, so it is asked once per branch.
  const [branchLists, categories] = await Promise.all([
    Promise.all(
      actor.branchIds.map((branchId) =>
        listCompanies(actor, {
          page: 1,
          pageSize: 200,
          limit: 200,
          offset: 0,
          sort: { field: 'legalName', direction: 'asc' },
          q: undefined,
          filters: { status: 'VERIFIED', branchId },
        }),
      ),
    ),
    listMasterData(actor, { type: 'JOB_CATEGORY' }),
  ]);
  const companies = branchLists
    .flatMap((list) => list.items)
    .sort((a, b) => a.legalName.localeCompare(b.legalName));

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
        initialCompanyId={companyId}
        successHref="/verifier/jobs"
      />
    </div>
  );
}
