import { getMyCompany } from '@/domains/company';
import { requireRole } from '@/domains/auth';
import { CompanyStatusPanel } from './_components/CompanyStatusPanel';
import { CompanyWizard } from './_components/CompanyWizard';

export const metadata = { title: 'Company registration' };

export default async function EmployerCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { actor } = await requireRole('EMPLOYER');
  const [company, { step }] = await Promise.all([getMyCompany(actor), searchParams]);

  if (!company) {
    return (
      <div className="grid gap-4">
        <CompanyWizard initialStep="details" initialCompany={null} />
      </div>
    );
  }

  // Only an un-verified company is editable by the employer: DRAFT, or fixing what
  // a verifier asked for (INFO_REQUESTED) / was rejected (REJECTED). Every other
  // status — VERIFIED, SUSPENDED, and anything waiting with a verifier — is
  // read-only here; a ?step= deep link must not reopen the wizard.
  const editableStatus =
    company.status === 'DRAFT' ||
    company.status === 'INFO_REQUESTED' ||
    company.status === 'REJECTED';
  if (!editableStatus) {
    return (
      <div className="grid gap-4">
        <CompanyStatusPanel company={company} />
      </div>
    );
  }

  const wizardStep = (step as string | undefined) ?? 'details';
  return (
    <div className="grid gap-4">
      <CompanyWizard initialStep={wizardStep} initialCompany={company} />
    </div>
  );
}
