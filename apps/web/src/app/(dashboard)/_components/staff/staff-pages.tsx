import type { Role } from '@jobbank/shared';
import { Avatar, StatusPill } from '@/components/atoms';
import { DetailPageLayout } from '@/components/templates';
import { requireRole } from '@/domains/auth';
import { listBranches } from '@/domains/branch';
import { getStaffMember } from '@/domains/user';
import { loadForPage } from '../../_lib/page-context';
import { STATUS_PILL } from './labels';
import { StaffDetailView } from './StaffDetailView';
import { StaffDirectory } from './staff-directory';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function StaffListPage({
  role,
  searchParams,
}: {
  role: Role;
  searchParams: SearchParams;
}) {
  const { actor } = await requireRole(role);
  return (
    <div className="grid w-full gap-6">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Staff</h1>
        <p className="text-fg-muted text-sm">
          {role === 'SUPER_ADMIN'
            ? 'Every staff account across branches. Use the branch switcher to focus on one branch.'
            : 'Staff and verification officers in your branch.'}
        </p>
      </header>
      <StaffDirectory actor={actor} searchParams={await searchParams} />
    </div>
  );
}

export async function StaffDetailPage({
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
  const [staff, branches] = await Promise.all([
    loadForPage(actor, () => getStaffMember(actor, id)),
    listBranches(actor),
  ]);
  return (
    <DetailPageLayout
      breadcrumbs={[{ label: 'Staff', href: basePath }, { label: staff.name }]}
      title={
        <span className="flex items-center gap-3">
          <Avatar name={staff.name} />
          {staff.name}
        </span>
      }
      subtitle={staff.title ?? undefined}
      status={<StatusPill {...STATUS_PILL[staff.status]} />}
    >
      <StaffDetailView
        staff={staff}
        branches={branches.filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name }))}
        listPath={basePath}
      />
    </DetailPageLayout>
  );
}
