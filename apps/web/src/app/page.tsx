import { homePathFor } from '@jobbank/shared';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { getServerAuthState } from '@/domains/auth';
import LandingPage from './_landing/LandingPage';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

export default async function HomePage() {
  const state = await getServerAuthState();
  const signedIn = state.status === 'active';
  const dashboardHref = signedIn ? homePathFor(state.actor.roles) : '/login';

  return (
    <div className={jakarta.className}>
      <LandingPage signedIn={signedIn} dashboardHref={dashboardHref} />
    </div>
  );
}
