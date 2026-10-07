import { getCompanyDetail } from '@/domains/company';
import { requireRole } from '@/domains/auth';
import { VerifierReviewPanel } from './_components/VerifierReviewPanel';

export const metadata = { title: 'Review company' };

export default async function VerifierReviewPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const [{ actor }, { companyId }] = await Promise.all([requireRole('VERIFIER'), params]);
  const company = await getCompanyDetail(actor, companyId);
  return <VerifierReviewPanel company={company} actorId={actor.userId} />;
}
