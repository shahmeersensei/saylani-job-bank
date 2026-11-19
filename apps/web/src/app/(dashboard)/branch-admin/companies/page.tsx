import { COMPANY_SORTABLE, companyFilters, listCompanies } from '@/domains/company';
import { requireRole } from '@/domains/auth';
import { Badge, Link } from '@/components/atoms';
import { EmptyState } from '@/components/molecules';
import { Building2 } from 'lucide-react';
import { parseListQuery } from '@/domains/shared/pagination';
import { BranchListPagination, branchListParams } from '../_components/BranchListControls';
import { InstantListFilters } from '../_components/InstantListFilters';
import { z } from 'zod';

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
const FILTER_STATUSES = [
  { value: 'VERIFIED', label: 'Verified' },
  // 2026-11-14: verification moved to Branch Admin — Draft and Submitted
  // companies awaiting review show here, next to Verified.
  { value: 'DRAFT', label: 'Draft — needs review' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'UNDER_VERIFICATION', label: 'Under Review' },
  { value: 'INFO_REQUESTED', label: 'Info needed' },
  { value: 'RESUBMITTED', label: 'Resubmitted — ready for review' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'REJECTED', label: 'Rejected' },
] as const;

export default async function BranchAdminCompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await requireRole('BRANCH_ADMIN');
  const params = branchListParams(await searchParams);
  if (!params.has('status')) params.set('status', 'VERIFIED');
  const query = parseListQuery(params, {
    sortable: COMPANY_SORTABLE,
    defaultSort: { field: 'legalName', direction: 'asc' },
    filters: {
      ...companyFilters,
      status: z.enum([
        'VERIFIED',
        'DRAFT',
        'SUBMITTED',
        'SUSPENDED',
        'UNDER_VERIFICATION',
        'INFO_REQUESTED',
        'RESUBMITTED',
        'REJECTED',
      ]),
    },
  });
  const [{ items, pagination }, allCompanies] = await Promise.all([
    listCompanies(actor, query),
    listCompanies(actor, {
      ...query,
      q: undefined,
      filters: {},
      page: 1,
      limit: 1,
      pageSize: 1,
      offset: 0,
    }),
  ]);

  return (
    <div className="grid w-full gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-fg text-2xl font-semibold">Companies</h1>
          <p className="text-fg-muted mt-1 text-sm">
            {allCompanies.pagination.total} in your branch
          </p>
        </div>
        {/*
          F9/N16 (2026-11-08): the legacy "Add company" page is gone. Branch
          Admins register companies from the sidebar "Register Company" dialog
          (RegisterCompanyDialog → POST /api/v1/companies/onboard), the same
          field-visit flow Super Admins and Verifiers use: outreach record,
          then a plain confirmation — printing and marking the form verified
          & signed happen on the company detail page (2026-11-14). The old
          page rendered StaffRegisterCompanyForm, which created a bare DRAFT
          with no outreach record and no path to VERIFIED.
        */}
      </header>

      <div className="grid gap-3">
        <InstantListFilters
          action="/branch-admin/companies"
          query={params.toString()}
          label="companies"
          statuses={FILTER_STATUSES}
          defaultStatus="VERIFIED"
        />
        <BranchListPagination
          action="/branch-admin/companies"
          params={params}
          meta={pagination}
          label="companies"
        />
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No matching companies"
          description="Try another status or search term."
        />
      ) : (
        <div className="grid gap-3">
          {items.map((c) => {
            const pill = STATUS_BADGE[c.status] ?? { label: c.status, tone: 'neutral' as const };
            return (
              <Link
                key={c.id}
                href={`/branch-admin/companies/${c.id}`}
                variant="unstyled"
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
