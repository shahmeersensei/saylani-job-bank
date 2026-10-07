import { redirect } from 'next/navigation';
import { Link } from '@/components/atoms';
import { AuthLayout } from '@/components/templates';
import { getServerAuthState } from '@/domains/auth';
import { homePathFor } from '@jobbank/shared';
import { EmployerSignupForm } from './EmployerSignupForm';

export const metadata = { title: 'Create employer account' };

export default async function RegisterPage() {
  const state = await getServerAuthState();
  if (state.status === 'active') redirect(homePathFor(state.actor.roles));

  return (
    <AuthLayout
      title="Register as an employer"
      subtitle="Create an account to post jobs and find verified candidates through Saylani Job Bank."
      footer={
        <>
          Already have an account? <Link href="/login">Sign in</Link>
        </>
      }
    >
      <EmployerSignupForm />
    </AuthLayout>
  );
}
