import { requireRole } from '@/domains/auth';
import { DetailPageLayout } from '@/components/templates';
import { BranchForm } from '../../../_components/branches/BranchForm';

export const metadata = { title: 'New branch' };

export default async function NewBranchPage() {
  await requireRole('SUPER_ADMIN');
  return (
    <DetailPageLayout
      breadcrumbs={[{ label: 'Branches', href: '/super-admin/branches' }, { label: 'New branch' }]}
      title="New branch"
      subtitle="Branches own their staff, applicants, companies and jobs."
    >
      <section className="border-border bg-surface shadow-card rounded-xl border p-5">
        <BranchForm />
      </section>
    </DetailPageLayout>
  );
}
