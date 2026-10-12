import { Lock } from 'lucide-react';
import { Button } from '@/components/atoms';
import { EmptyState } from '@/components/molecules';
import { getServerAuthState } from '@/domains/auth';
import { homePathFor } from '@jobbank/shared';
import NextLink from 'next/link';

export const metadata = { title: 'Not allowed' };

export default async function ForbiddenPage() {
  const state = await getServerAuthState();
  const home = state.status === 'active' ? homePathFor(state.actor.roles) : '/login';
  return (
    <main className="page-gutter flex min-h-dvh items-center justify-center">
      <EmptyState
        icon={Lock}
        title="You don't have access to this page"
        titleAs="h1"
        description="This area belongs to a different role. If you need access, ask your branch admin."
        action={
          <Button asChild>
            <NextLink href={home}>Go to my dashboard</NextLink>
          </Button>
        }
      />
    </main>
  );
}
