import { requireSignedIn } from '@/domains/auth';
import { listMyNotifications } from '@/domains/notifications';
import { NotificationsClient } from '../applicant/notifications/_components/NotificationsClient';

export const metadata = { title: 'Notifications — Saylani Job Bank' };

export default async function NotificationsPage() {
  const { actor } = await requireSignedIn();
  const notifications = await listMyNotifications(actor, { page: 1, pageSize: 20 });

  return (
    <div className="grid w-full gap-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold">Notifications</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Updates about your jobs, matches and decisions.
        </p>
      </header>
      <NotificationsClient
        items={notifications.items}
        unread={notifications.unread}
        offers={[]}
        refusalReasons={[]}
      />
    </div>
  );
}
