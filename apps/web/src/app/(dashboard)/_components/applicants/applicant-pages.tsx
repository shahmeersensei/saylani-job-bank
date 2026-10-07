import type { Role } from '@jobbank/shared';
import { StatusPill } from '@/components/atoms';
import { DetailPageLayout } from '@/components/templates';
import {
  APPLICANT_SORTABLE,
  applicantFilters,
  getApplicantForStaff,
  listApplicants,
} from '@/domains/applicant';
import { requireRole } from '@/domains/auth';
import { listBranches, listBranchOptions } from '@/domains/branch';
import { listMasterData } from '@/domains/settings';
import { ValidationError } from '@/domains/shared/errors';
import { parseListQuery } from '@/domains/shared/pagination';
import { isSuperAdmin } from '@/domains/shared/scope';
import { loadForPage } from '../../_lib/page-context';
import { ApplicantDetailView } from './ApplicantDetailView';
import { ApplicantsTable } from './ApplicantsTable';
import { APPLICANT_STATUS_PILL } from './labels';
import { profileLabels } from './lists';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const listOptions = {
  sortable: APPLICANT_SORTABLE,
  defaultSort: { field: 'createdAt' as const, direction: 'desc' as const },
  filters: applicantFilters,
};

/** Branch-scoped applicant search; filters live in the URL so views can be shared. */
export async function ApplicantListPage({
  role,
  searchParams,
}: {
  role: Role;
  searchParams: SearchParams;
}) {
  const { actor } = await requireRole(role);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string' && value) params.set(key, value);
  }
  let query;
  try {
    query = parseListQuery(params, listOptions);
  } catch (error) {
    // A hand-edited URL with bad filters falls back to the default view.
    if (!(error instanceof ValidationError)) throw error;
    query = parseListQuery(new URLSearchParams(), listOptions);
  }
  const [{ data, meta }, branches, skills] = await Promise.all([
    loadForPage(actor, () => listApplicants(actor, query)),
    listBranches(actor),
    listMasterData(actor, { type: 'SKILL' }),
  ]);

  return (
    <div className="grid w-full gap-6">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Applicants</h1>
        <p className="text-fg-muted text-sm">
          {isSuperAdmin(actor) && !actor.activeBranchId
            ? 'Job seekers across all branches. Use the branch switcher to focus on one branch.'
            : 'Job seekers registered with your branch.'}
        </p>
      </header>
      <ApplicantsTable
        rows={data}
        meta={meta}
        sort={{ id: query.sort.field, direction: query.sort.direction }}
        branches={branches.map((b) => ({ value: b.id, label: b.name }))}
        skills={skills.map((s) => ({ value: s.code, label: s.label }))}
      />
    </div>
  );
}

export async function ApplicantDetailPage({
  role,
  basePath,
  params,
}: {
  role: Role;
  basePath: string;
  params: Promise<{ id: string }>;
}) {
  const { actor } = await requireRole(role);
  const { id } = await params;
  const applicant = await loadForPage(actor, () => getApplicantForStaff(actor, id));
  const [labels, branches] = await Promise.all([
    profileLabels(),
    // Transfers can go to any active branch, not only the ones the admin manages.
    applicant.can.transfer
      ? listBranchOptions(applicant.address?.location ?? { lat: 30.3753, lng: 69.3451 })
      : Promise.resolve([]),
  ]);
  return (
    <DetailPageLayout
      breadcrumbs={[
        { label: 'Applicants', href: basePath },
        { label: applicant.personal.fullName },
      ]}
      title={applicant.personal.fullName}
      subtitle={
        [applicant.branch?.name, `${applicant.completeness.percent}% complete`]
          .filter(Boolean)
          .join(' · ') || undefined
      }
      status={<StatusPill {...APPLICANT_STATUS_PILL[applicant.status]} />}
    >
      <ApplicantDetailView
        applicant={applicant}
        labels={labels}
        branches={branches.map((b) => ({ value: b.id, label: b.name }))}
        listPath={basePath}
      />
    </DetailPageLayout>
  );
}
