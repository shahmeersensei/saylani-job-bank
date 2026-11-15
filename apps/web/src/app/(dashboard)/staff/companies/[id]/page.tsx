import { getCompanyDetail, getCompanyOnboarding } from '@/domains/company';
import { listCompanyJobs } from '@/domains/job';
import { requireRole } from '@/domains/auth';
import { listMasterData } from '@/domains/settings';
import { StaffCompanyPanel } from '@/app/(dashboard)/branch-admin/companies/[id]/_components/StaffCompanyPanel';

export const metadata = { title: 'Company detail' };

/**
 * Staff company detail. No /staff/companies route existed — staff had no
 * company profile surface at all — so this reuses the shared
 * StaffCompanyPanel read-only (no suspend / correct / onboard actions).
 * getCompanyDetail only shows VERIFIED/SUSPENDED companies to company:read
 * holders, and the panel's "Post a job" button links to /staff/jobs/new
 * with this company preselected.
 */
export default async function StaffCompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ actor }, { id }] = await Promise.all([requireRole('STAFF'), params]);
  const [categories, company, jobs, onboarding] = await Promise.all([
    listMasterData(actor, { type: 'JOB_CATEGORY' }),
    getCompanyDetail(actor, id),
    listCompanyJobs(actor, id),
    getCompanyOnboarding(actor, id),
  ]);
  return (
    <StaffCompanyPanel
      company={company}
      onboarding={onboarding}
      canSuspend={false}
      canManage={false}
      canOnboard={false}
      canVerify={actor.permissions.has('company:verify')}
      jobs={jobs}
      canManageJobs={actor.permissions.has('job:manage')}
      categories={categories.map((item) => ({ code: item.code, label: item.label }))}
    />
  );
}
