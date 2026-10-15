import NextLink from 'next/link';
import { requireRole } from '@/domains/auth';
import { getMyPendingOffers, listRefusalReasons } from '@/domains/matching';
import { listMyNotifications } from '@/domains/notifications';
import { Button } from '@/components/atoms';
import { NotificationsClient } from './_components/NotificationsClient';

export const metadata = { title: 'Updates — Saylani Job Bank' };

const PAGE_SIZE = 20;

export default async function ApplicantNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { actor } = await requireRole('APPLICANT');
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);

  const [notifications, offers, refusalReasons] = await Promise.all([
    listMyNotifications(actor, { page, pageSize: PAGE_SIZE }),
    getMyPendingOffers(actor),
    listRefusalReasons(),
  ]);

  const pageCount = Math.max(1, Math.ceil(notifications.total / PAGE_SIZE));

  return (
    <div className="grid w-full gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-fg text-2xl font-semibold">Updates</h1>
          <p className="text-fg-muted mt-1 text-sm">
            Job matches, shortlist decisions and offers from employers.
          </p>
        </div>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <NextLink
                href={
                  page <= 1
                    ? '/applicant/notifications'
                    : `/applicant/notifications?page=${page - 1}`
                }
              >
                Previous
              </NextLink>
            </Button>
            <span className="text-fg-muted numeric text-sm">
              {page} / {pageCount}
            </span>
            <Button asChild variant="secondary" size="sm">
              <NextLink
                href={
                  page >= pageCount
                    ? '/applicant/notifications'
                    : `/applicant/notifications?page=${page + 1}`
                }
              >
                Next
              </NextLink>
            </Button>
          </div>
        )}
      </header>

      <NotificationsClient
        items={notifications.items}
        unread={notifications.unread}
        offers={offers}
        refusalReasons={refusalReasons}
      />
    </div>
  );
}
