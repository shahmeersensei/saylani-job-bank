'use client';

import { Building2, Plus } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, StatusPill } from '@/components/atoms';
import { EmptyState } from '@/components/molecules';
import { DataTable } from '@/components/organisms';
import type { BranchView } from '@/domains/branch';

export function BranchesTable({
  branches,
  canCreate,
}: {
  branches: BranchView[];
  canCreate: boolean;
}) {
  const router = useRouter();
  return (
    <DataTable<BranchView>
      caption="Branches"
      rows={branches}
      getRowId={(b) => b.id}
      onRowClick={(b) => router.push(`/super-admin/branches/${b.id}`)}
      toolbar={
        canCreate && (
          <Button asChild className="ms-auto">
            <NextLink href="/super-admin/branches/new">
              <Plus aria-hidden="true" /> New branch
            </NextLink>
          </Button>
        )
      }
      empty={
        <EmptyState
          icon={Building2}
          title="No branches yet"
          description="Create the first Job Bank branch."
        />
      }
      columns={[
        {
          id: 'name',
          header: 'Branch',
          cell: (b) => (
            <div className="grid">
              <span className="font-medium">{b.name}</span>
              <span className="text-fg-subtle font-mono text-xs">{b.code}</span>
            </div>
          ),
        },
        { id: 'city', header: 'City', hideBelow: 'sm', cell: (b) => b.city },
        {
          id: 'staff',
          header: 'Staff',
          align: 'end',
          cell: (b) => <span className="numeric">{b.staffCount}</span>,
        },
        {
          id: 'status',
          header: 'Status',
          cell: (b) => (
            <StatusPill
              label={b.isActive ? 'Active' : 'Inactive'}
              tone={b.isActive ? 'success' : 'neutral'}
            />
          ),
        },
      ]}
    />
  );
}
