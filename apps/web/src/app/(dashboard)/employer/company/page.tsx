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
    return <CompanyWizard initialStep="details" initialCompany={null} />;
  }

  if (company.status === 'VERIFIED' || company.status === 'SUSPENDED') {
    return <CompanyStatusPanel company={company} />;
  }

  const wizardStep = (step as string | undefined) ?? 'details';
  return <CompanyWizard initialStep={wizardStep} initialCompany={company} />;
}
