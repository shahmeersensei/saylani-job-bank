import { listCompanies } from '@/domains/company';
import { requireRole } from '@/domains/auth';
import { Badge, Button, Link } from '@/components/atoms';
import { EmptyState } from '@/components/molecules';
import { Building2, PlusCircle } from 'lucide-react';
import NextLink from 'next/link';

export const metadata = { title: 'Companies' };

const STATUS_BADGE: Record<
  string,
  { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info' }
> = {
  VERIFIED: { label: 'Verified', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' },
  UNDER_VERIFICATION: { label: 'Under review', tone: 'info' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  RESUBMITTED: { label: 'Resubmitted', tone: 'info' },
  INFO_REQUESTED: { label: 'Info needed', tone: 'warning' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  DRAFT: { label: 'Draft', tone: 'neutral' },
};

export default async function BranchAdminCompaniesPage() {
  const { actor } = await requireRole('BRANCH_ADMIN');
  const { items, pagination } = await listCompanies(actor, {
    page: 1,
    pageSize: 100,
    limit: 100,
    offset: 0,
    sort: { field: 'legalName', direction: 'asc' },
    q: undefined,
    filters: {},
  });

  return (
    <div className="grid w-full gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-fg text-2xl font-semibold">Companies</h1>
          <p className="text-fg-muted mt-1 text-sm">{pagination.total} in your branch</p>
        </div>
        <Button asChild size="sm">
          <NextLink href="/branch-admin/companies/new">
            <PlusCircle className="mr-1.5 size-4" />
            Add company
          </NextLink>
        </Button>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No companies yet"
          description="Employers will appear here once they register."
        />
      ) : (
        <div className="grid gap-3">
          {items.map((c) => {
            const pill = STATUS_BADGE[c.status] ?? { label: c.status, tone: 'neutral' as const };
            return (
              <Link
                key={c.id}
                href={`/branch-admin/companies/${c.id}`}
                className="border-border bg-surface hover:bg-surface-muted flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <Building2 className="text-fg-muted mt-0.5 size-5 shrink-0" />
                  <div>
                    <p className="text-fg font-medium">{c.legalName}</p>
                    <p className="text-fg-muted text-sm">{c.ntn}</p>
                  </div>
                </div>
                <Badge tone={pill.tone}>{pill.label}</Badge>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
