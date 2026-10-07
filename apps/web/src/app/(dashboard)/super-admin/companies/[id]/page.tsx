import { getCompanyDetail } from '@/domains/company';
import { requireRole } from '@/domains/auth';
import { StaffCompanyPanel } from '@/app/(dashboard)/branch-admin/companies/[id]/_components/StaffCompanyPanel';

export const metadata = { title: 'Company detail' };

export default async function SuperAdminCompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ actor }, { id }] = await Promise.all([requireRole('SUPER_ADMIN'), params]);
  const company = await getCompanyDetail(actor, id);
  return <StaffCompanyPanel company={company} canSuspend canManage />;
}
