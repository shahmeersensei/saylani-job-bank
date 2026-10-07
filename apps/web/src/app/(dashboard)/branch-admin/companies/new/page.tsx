import { requireRole } from '@/domains/auth';
import { listBranches } from '@/domains/branch';
import { listMasterData } from '@/domains/settings';
import { StaffRegisterCompanyForm } from './_components/StaffRegisterCompanyForm';

export const metadata = { title: 'Add company' };

export default async function BranchAdminAddCompanyPage() {
  const { actor } = await requireRole('BRANCH_ADMIN');
  const [branches, industries] = await Promise.all([
    listBranches(actor),
    listMasterData(actor, { type: 'INDUSTRY' }),
  ]);

  const myBranches = branches
    .filter((b) => b.isActive && actor.branchIds.includes(b.id))
    .map((b) => ({ id: b.id, name: b.name }));

  return (
    <div className="grid w-full gap-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold">Add company</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Register a company on behalf of an employer in your branch.
        </p>
      </header>
      <StaffRegisterCompanyForm
        branches={myBranches}
        industries={industries.map((i) => ({ code: i.code, label: i.label }))}
      />
    </div>
  );
}
