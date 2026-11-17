import { redirect } from 'next/navigation';
import { getApplicantForStaff, listApplicantDocumentTypes } from '@/domains/applicant';
import { requireRole } from '@/domains/auth';
import { listRefusalReasons } from '@/domains/matching';
import { listCandidateCalls } from '@/domains/placement';
import { profileLists } from '../applicants/lists';
import { WIZARD_STEPS } from '../../applicant/_components/wizard-steps';
import { CallList } from './CallList';
import { CounterRegisterForm } from './CounterRegisterForm';
import { CounterWizard } from './CounterWizard';

type CounterRole = 'STAFF' | 'BRANCH_ADMIN';

export async function CounterRegisterPage({
  role,
  basePath,
}: {
  role: CounterRole;
  basePath: string;
}) {
  await requireRole(role);
  return (
    <div className="grid w-full gap-6">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Register a candidate</h1>
        <p className="text-fg-muted text-sm">
          For people without a smartphone or email. They will not need an account: your branch keeps
          their profile and contacts them.
        </p>
      </header>
      <CounterRegisterForm basePath={basePath} />
    </div>
  );
}

export async function CounterCompletePage({
  role,
  basePath,
  params,
}: {
  role: CounterRole;
  basePath: string;
  params: Promise<{ id: string }>;
}) {
  const { actor } = await requireRole(role);
  const { id } = await params;
  const applicant = await getApplicantForStaff(actor, id);
  const detailHref = `${basePath}/${id}`;
  // Candidates with their own login keep their profile themselves.
  if (!applicant.counterRegistered) redirect(detailHref);

  const [lists, documentTypes] = await Promise.all([
    profileLists(actor),
    listApplicantDocumentTypes(),
  ]);
  return (
    <CounterWizard
      applicantId={id}
      detailHref={detailHref}
      initialProfile={applicant}
      initialStep={WIZARD_STEPS.findIndex((s) => s.id === 'location')}
      lists={lists}
      documentTypes={documentTypes}
    />
  );
}

export async function CallListPage({ role, basePath }: { role: CounterRole; basePath: string }) {
  const { actor } = await requireRole(role);
  const [items, refusalReasons] = await Promise.all([
    listCandidateCalls(actor),
    listRefusalReasons(),
  ]);
  return (
    <div className="grid w-full gap-6">
      <header className="grid gap-1">
        <h1 className="text-fg text-2xl font-semibold">Call list</h1>
        <p className="text-fg-muted text-sm">
          News for candidates registered at a counter. They do not get app notifications or email,
          so someone has to tell them.
        </p>
      </header>
      <CallList items={items} basePath={basePath} refusalReasons={refusalReasons} />
    </div>
  );
}
