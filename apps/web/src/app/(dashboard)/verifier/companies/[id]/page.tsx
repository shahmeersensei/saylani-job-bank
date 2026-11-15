import { getCompanyDetail, getCompanyOnboarding } from '@/domains/company';
import { listCompanyJobs } from '@/domains/job';
import { requireRole } from '@/domains/auth';
import { listMasterData } from '@/domains/settings';
import { hasPermission } from '@/domains/shared/scope';
import { StaffCompanyPanel } from '@/app/(dashboard)/branch-admin/companies/[id]/_components/StaffCompanyPanel';

export const metadata = { title: 'Company detail' };

export default async function VerifierCompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ actor }, { id }] = await Promise.all([requireRole('VERIFIER'), params]);
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
      canManage={hasPermission(actor, 'company:manage')}
      canOnboard
      canVerify={actor.permissions.has('company:verify')}
      jobs={jobs}
      canManageJobs={actor.permissions.has('job:manage')}
      categories={categories.map((item) => ({ code: item.code, label: item.label }))}
    />
  );
}
