import { redirect } from 'next/navigation';
import { getMyProfile, listApplicantDocumentTypes } from '@/domains/applicant';
import { requireRole } from '@/domains/auth';
import { DocumentsPageClient } from '../_components/DocumentsPageClient';

export const metadata = { title: 'My documents' };

export default async function ApplicantDocumentsPage() {
  const { actor } = await requireRole('APPLICANT');
  const [profile, types] = await Promise.all([getMyProfile(actor), listApplicantDocumentTypes()]);
  if (!profile) redirect('/applicant/profile');
  return (
    <div className="grid w-full gap-6">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">My documents</h1>
        <p className="text-fg-muted text-sm">
          Only you and Job Bank staff can see these. Employers never receive your documents.
        </p>
      </header>
      <DocumentsPageClient initialProfile={profile} types={types} />
    </div>
  );
}
