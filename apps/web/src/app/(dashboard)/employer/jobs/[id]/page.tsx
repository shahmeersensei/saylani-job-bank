import { requireRole } from '@/domains/auth';
import { getMyJob } from '@/domains/job';
import { NotFoundError } from '@/domains/shared/errors';
import { notFound } from 'next/navigation';
import { JobDetailPanel } from '../_components/JobDetailPanel';

export const metadata = { title: 'Job' };

export default async function EmployerJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { actor } = await requireRole('EMPLOYER');
  const { id } = await params;

  try {
    const job = await getMyJob(actor, id);
    return <JobDetailPanel job={job} />;
  } catch (e) {
    if (e instanceof NotFoundError) return notFound();
    throw e;
  }
}
