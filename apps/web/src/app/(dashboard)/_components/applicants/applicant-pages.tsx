import type { Role } from '@jobbank/shared';
import { Button, StatusPill } from '@/components/atoms';
import { DetailPageLayout } from '@/components/templates';
import {
  APPLICANT_SORTABLE,
  applicantFilters,
  getApplicantForStaff,
  listApplicants,
} from '@/domains/applicant';
import { requireRole } from '@/domains/auth';
import { listBranches, listBranchOptions } from '@/domains/branch';
import { isReferrableApplicant } from '@/domains/job';
import { listMatchedJobsForStaff } from '@/domains/matching';
import { listApplicationsForApplicant } from '@/domains/placement';
import { listMasterData } from '@/domains/settings';
import { ValidationError } from '@/domains/shared/errors';
import { parseListQuery } from '@/domains/shared/pagination';
import { hasPermission, isSuperAdmin } from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { schema } from '@jobbank/db';
import { and, eq, sql } from 'drizzle-orm';
import { loadForPage } from '../../_lib/page-context';
import { ApplicantDetailView } from './ApplicantDetailView';
import { ApplicantsTable } from './ApplicantsTable';
import { APPLICANT_STATUS_PILL } from './labels';
import { profileLabels, profileLists } from './lists';
import { StaffRegisterApplicantForm } from './StaffRegisterApplicantForm';
import { TokenRegistrationFlow } from './TokenRegistrationFlow';
import { redirect } from 'next/navigation';
import Link from 'next/link';

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
  const [{ data, meta }, branches, skills, cities, areas] = await Promise.all([
    loadForPage(actor, () => listApplicants(actor, query)),
    listBranches(actor),
    listMasterData(actor, { type: 'SKILL' }),
    listMasterData(actor, { type: 'CITY' }),
    listMasterData(actor, { type: 'AREA' }),
  ]);

  // Counter 2 entry point (2026-11-13): only Staff register applicants from a token here.
  // Branch Admin and Super Admin do not register applicants (decided 2026-11-18/19), and other
  // roles cannot register, so they get no Register-from-token button. Kept over PR #3, which
  // still gave Super Admin the button.
  const registerBasePath = role === 'STAFF' ? '/staff/applicants' : null;

  return (
    <div className="grid w-full gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-fg text-2xl font-semibold">Applicants</h1>
          <p className="text-fg-muted text-sm">
            {isSuperAdmin(actor) && !actor.activeBranchId
              ? 'Job seekers across all branches. Use the branch switcher to focus on one branch.'
              : 'Job seekers registered with your branch.'}
          </p>
        </div>
        {/*
          Audit 2026-11-11 (H-14): no "Register job seeker" button here
          any more — the /new routes are deleted. Registration starts with
          the sidebar "Issue token" dialog (token-only first counter step),
          then completes through the same form in edit mode on the
          applicant's complete page.
          Counter 2 (2026-11-13): the "Register from token" button below is
          the create-mode entry for roles allowed to register applicants.
        */}
        {registerBasePath && (
          <Button asChild>
            <Link href={`${registerBasePath}/register-from-token`}>Register from token</Link>
          </Button>
        )}
      </header>
      <ApplicantsTable
        rows={data}
        meta={meta}
        sort={{ id: query.sort.field, direction: query.sort.direction }}
        branches={branches.map((b) => ({ value: b.id, label: b.name }))}
        skills={skills.map((s) => ({ value: s.code, label: s.label }))}
        cities={cities.map((c) => ({ value: c.code, label: c.label, id: c.id }))}
        areas={areas.map((a) => ({ value: a.code, label: a.label, parentId: a.parentId }))}
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

  // Fetch open jobs in the applicant's city for the shortlist picker
  const openJobsPromise =
    applicant.can.shortlist && applicant.address?.cityCode
      ? db
          .select({
            id: schema.jobs.id,
            title: schema.jobs.title,
            companyId: schema.jobs.companyId,
          })
          .from(schema.jobs)
          .innerJoin(schema.jobLocations, eq(schema.jobs.id, schema.jobLocations.jobId))
          .where(
            and(
              eq(schema.jobs.status, 'OPEN'),
              sql`upper(${schema.jobLocations.cityCode}) = upper(${applicant.address.cityCode})`,
            ),
          )
          .limit(100)
          .then((rows) => rows.map((r) => ({ value: r.id, label: r.title })))
      : Promise.resolve([]);

  // AI-ranked jobs for referral: only when this staff member may refer jobs
  // and this applicant may receive one. The domain function re-checks both.
  const canReferMatchedJobs = hasPermission(actor, 'job:refer') && isReferrableApplicant(applicant);
  const [labels, branches, openJobs, existingApplications, matchedJobs] = await Promise.all([
    profileLabels(),
    applicant.can.transfer
      ? listBranchOptions(applicant.address?.location ?? { lat: 30.3753, lng: 69.3451 })
      : Promise.resolve([]),
    openJobsPromise,
    // Applications are loaded for shortlisting AND for interview
    // scheduling: the Interviewer and Scheduler role cannot shortlist
    // (no match_case:manage) but needs the list to reach the
    // schedule/update dialogs on the detail page.
    applicant.can.shortlist || applicant.can.scheduleInterview
      ? listApplicationsForApplicant(actor, applicant.id)
      : Promise.resolve([]),
    canReferMatchedJobs ? listMatchedJobsForStaff(actor, applicant.id) : Promise.resolve([]),
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
        openJobs={openJobs}
        existingApplications={existingApplications}
        matchedJobs={matchedJobs}
        canReferMatchedJobs={canReferMatchedJobs}
        listPath={basePath}
      />
    </DetailPageLayout>
  );
}

export async function ApplicantEditPage({
  role,
  basePath,
  params,
}: {
  role: Role;
  basePath: string;
  params: Promise<{ id: string }>;
}) {
  const { actor } = await requireRole(role);
  if (!actor.permissions.has('applicant:manage')) redirect('/forbidden');
  const { id } = await params;
  const [applicant, lists] = await Promise.all([
    loadForPage(actor, () => getApplicantForStaff(actor, id)),
    profileLists(actor),
  ]);
  return (
    <div className="grid w-full gap-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold">Edit job seeker profile</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Update the existing profile for {applicant.personal.fullName}.
        </p>
      </header>
      <StaffRegisterApplicantForm
        applicant={applicant}
        branches={
          applicant.branch ? [{ value: applicant.branch.id, label: applicant.branch.name }] : []
        }
        cities={lists.cities}
        areas={lists.areas}
        educationLevels={lists.educationLevels}
        skills={lists.skills}
        languages={lists.languages}
        categories={lists.categories}
        basePath={basePath}
      />
    </div>
  );
}

export function ApplicantEditLoading() {
  return (
    <div className="grid w-full gap-6" role="status" aria-label="Loading applicant profile">
      <div className="bg-surface-muted h-8 w-64 animate-pulse rounded" />
      <div className="bg-surface-muted h-40 animate-pulse rounded-xl" />
      <div className="bg-surface-muted h-40 animate-pulse rounded-xl" />
      <span className="sr-only">Loading applicant profile...</span>
    </div>
  );
}

/**
 * Counter 2 (2026-11-13): find the token issued at Counter 1, check it
 * against the applicant's CNIC card, then complete the full registration
 * on their behalf. The tokenId travels in component state only, never in
 * the URL — the lookup and the form live on this one page.
 */
export async function TokenRegistrationPage({ role, basePath }: { role: Role; basePath: string }) {
  const { actor } = await requireRole(role);
  const [lists, branches] = await Promise.all([profileLists(actor), listBranches(actor)]);
  return (
    <div className="grid w-full gap-6">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Register from token</h1>
        <p className="text-fg-muted text-sm">
          Find the token issued at Counter 1, check the name and CNIC against the applicant&apos;s
          CNIC card, then complete the registration on their behalf. Saving the form completes the
          token.
        </p>
      </header>
      <TokenRegistrationFlow
        branches={branches.map((b) => ({ value: b.id, label: b.name, code: b.code }))}
        cities={lists.cities}
        areas={lists.areas}
        educationLevels={lists.educationLevels}
        skills={lists.skills}
        languages={lists.languages}
        categories={lists.categories}
        basePath={basePath}
      />
    </div>
  );
}
