import { requireRole } from '@/domains/auth';
import { getMyJob } from '@/domains/job';
import { getJobMatches, listRejectionReasons } from '@/domains/matching';
import { NotFoundError } from '@/domains/shared/errors';
import { notFound } from 'next/navigation';
import { MatchesShortlist } from '../../_components/MatchesShortlist';

export const metadata = { title: 'Shortlist' };

const PAGE_SIZE = 20;

export default async function EmployerJobMatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { actor } = await requireRole('EMPLOYER');
  const { id } = await params;
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);

  try {
    const [job, matches, reasons] = await Promise.all([
      getMyJob(actor, id),
      getJobMatches(actor, id, { page, pageSize: PAGE_SIZE }),
      listRejectionReasons(),
    ]);
    return (
      <MatchesShortlist
        jobId={job.id}
        matches={matches}
        page={page}
        pageSize={PAGE_SIZE}
        reasons={reasons}
      />
    );
  } catch (e) {
    if (e instanceof NotFoundError) return notFound();
    throw e;
  }
}
