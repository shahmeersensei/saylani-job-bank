import { redirect } from 'next/navigation';
import { getServerAuthState } from '@/domains/auth';
import { homePathFor } from '@jobbank/shared';
import { AuthLayout } from '@/components/templates';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const state = await getServerAuthState();
  if (state.status === 'active') redirect(homePathFor(state.actor.roles));
  if (state.status === 'blocked') redirect('/account-disabled');

  const { next } = await searchParams;
  return (
    <AuthLayout title="Welcome back" subtitle="Select your role to sign in to Saylani Job Bank.">
      <LoginForm next={next ?? null} />
    </AuthLayout>
  );
}
