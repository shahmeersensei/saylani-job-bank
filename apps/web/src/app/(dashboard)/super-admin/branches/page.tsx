import { requireRole } from '@/domains/auth';
import { listBranches } from '@/domains/branch';
import { BranchesTable } from '../../_components/branches/BranchesTable';

export const metadata = { title: 'Branches' };

export default async function BranchesPage() {
  const { actor } = await requireRole('SUPER_ADMIN');
  const branches = await listBranches(actor);

  return (
    <div className="grid w-full gap-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-fg text-2xl font-bold">Branches</h1>
          <p className="text-fg-muted text-sm">
            {actor.activeBranchId
              ? 'Showing the branch selected in the top bar.'
              : `All ${branches.length} Job Bank branch${branches.length !== 1 ? 'es' : ''}.`}
          </p>
        </div>
      </header>
      <BranchesTable branches={branches} canCreate={actor.permissions.has('branch:manage')} />
    </div>
  );
}
