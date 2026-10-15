'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DropdownMenu } from 'radix-ui';
import { formatDate } from '@/lib/format/date';
import { apiFetch } from '@/lib/api/client';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export function NotificationBell({ viewAllHref = '/notifications' }: { viewAllHref?: string }) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    apiFetch<NotificationItem[]>('/api/v1/notifications?pageSize=8')
      .then(({ data, meta }) => {
        setItems(data);
        if (meta) setUnread(meta.total - data.filter((i) => i.readAt).length);
      })
      .catch(() => {});
  }, [open]);

  async function markRead(id: string) {
    try {
      await apiFetch(`/api/v1/notifications/${id}`, { method: 'PATCH' });
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, readAt: new Date().toISOString() } : i)),
      );
      setUnread((u) => Math.max(0, u - 1));
      router.refresh();
    } catch {
      // mark-read failure is non-critical; UI already updated optimistically
    }
  }

  async function markAll() {
    try {
      await apiFetch('/api/v1/notifications/read-all', { method: 'POST' });
      setItems((prev) => prev.map((i) => ({ ...i, readAt: new Date().toISOString() })));
      setUnread(0);
    } catch {
      // mark-all failure is non-critical
    }
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
          className="hover:bg-surface-muted focus-visible:focus-ring relative grid size-10 place-items-center rounded-lg transition-colors"
        >
          <Bell className="text-fg-muted size-[18px]" aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="bg-primary absolute top-2 right-2 min-w-4 rounded-full px-1 text-[10px] leading-4 font-bold text-white"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="border-border bg-surface shadow-popover z-50 w-80 rounded-xl border"
        >
          <div className="border-border flex items-center justify-between border-b px-4 py-3">
            <span className="text-fg text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="text-primary hover:text-primary/80 text-xs font-medium"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="text-fg-muted px-4 py-8 text-center text-sm">No notifications yet.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => item.readAt === null && markRead(item.id)}
                  className={`hover:bg-surface-muted flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                    item.readAt === null ? 'bg-primary-soft/30' : ''
                  }`}
                >
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${
                      item.readAt === null ? 'bg-primary' : 'bg-transparent'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-fg truncate text-sm font-medium">{item.title}</span>
                    {item.body && (
                      <span className="text-fg-muted line-clamp-2 text-xs">{item.body}</span>
                    )}
                    <span className="text-fg-subtle text-xs">{formatDate(item.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="border-border border-t p-2">
            <Link
              href={viewAllHref}
              onClick={() => setOpen(false)}
              className="text-primary hover:text-primary/80 block rounded-lg px-3 py-2 text-center text-sm font-medium"
            >
              View all notifications
            </Link>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
