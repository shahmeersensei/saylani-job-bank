import { Users } from 'lucide-react';
import NextLink from 'next/link';
import { Button, StatusPill } from '@/components/atoms';
import { KeyValue } from '@/components/molecules';
import { DetailPageLayout } from '@/components/templates';
import { requireRole } from '@/domains/auth';
import { getBranch } from '@/domains/branch';
import { BranchDeleteButton } from '../../../_components/branches/BranchDeleteButton';
import { BranchForm } from '../../../_components/branches/BranchForm';
import { BranchStatusButton } from '../../../_components/branches/BranchStatusButton';
import { loadForPage } from '../../../_lib/page-context';

export const metadata = { title: 'Branch' };

export default async function BranchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireRole('SUPER_ADMIN');
  const { id } = await params;
  const branch = await loadForPage(actor, () => getBranch(actor, id));

  return (
    <DetailPageLayout
      breadcrumbs={[{ label: 'Branches', href: '/super-admin/branches' }, { label: branch.code }]}
      title={branch.name}
      subtitle={`${branch.code} · ${branch.city}`}
      status={
        <StatusPill
          label={branch.isActive ? 'Active' : 'Inactive'}
          tone={branch.isActive ? 'success' : 'neutral'}
        />
      }
      actions={
        <>
          <Button asChild variant="secondary">
            <NextLink href={`/super-admin/staff?branchId=${branch.id}`}>
              <Users aria-hidden="true" /> View staff
            </NextLink>
          </Button>
          <BranchStatusButton branchId={branch.id} isActive={branch.isActive} name={branch.name} />
          {!branch.isActive && <BranchDeleteButton branchId={branch.id} name={branch.name} />}
        </>
      }
      aside={
        <section className="border-border bg-surface shadow-card grid gap-4 rounded-xl border p-5">
          <h2 className="text-fg text-base font-semibold">Summary</h2>
          <KeyValue
            columns={1}
            items={[
              {
                label: 'Staff accounts',
                value: <span className="numeric">{branch.staffCount}</span>,
              },
              { label: 'Phone', value: branch.phone },
            ]}
          />
        </section>
      }
    >
      <section className="border-border bg-surface shadow-card grid gap-4 rounded-xl border p-5">
        <h2 className="text-fg text-base font-semibold">Details</h2>
        <BranchForm branch={branch} />
      </section>
    </DetailPageLayout>
  );
}
