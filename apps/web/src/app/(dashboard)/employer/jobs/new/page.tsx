import { requireRole } from '@/domains/auth';
import { JobWizard } from '../_components/JobWizard';

export const metadata = { title: 'Post a job' };

export default async function NewJobPage() {
  await requireRole('EMPLOYER');
  return <JobWizard />;
}
