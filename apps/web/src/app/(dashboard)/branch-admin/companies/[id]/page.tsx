import { getCompanyDetail, getCompanyOnboarding } from '@/domains/company';
import { listCompanyJobs } from '@/domains/job';
import { requireRole } from '@/domains/auth';
import { listMasterData } from '@/domains/settings';
import { StaffCompanyPanel } from './_components/StaffCompanyPanel';

export const metadata = { title: 'Company detail' };

export default async function BranchAdminCompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ actor }, { id }] = await Promise.all([requireRole('BRANCH_ADMIN'), params]);
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
      canSuspend={actor.permissions.has('company:suspend')}
      canManage={false}
      canOnboard
      canVerify={
        actor.permissions.has('company:verify') &&
        company.branch !== null &&
        actor.branchIds.includes(company.branch.id)
      }
      jobs={jobs}
      canManageJobs={actor.permissions.has('job:manage')}
      categories={categories.map((item) => ({ code: item.code, label: item.label }))}
    />
  );
}
