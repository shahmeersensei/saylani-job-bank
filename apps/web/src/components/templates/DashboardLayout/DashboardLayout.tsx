'use client';

import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { BrandMark } from '@/components/brand';
import { AppSidebar } from '@/components/organisms/AppSidebar';
import { TopBar } from '@/components/organisms/TopBar';
import type { DashboardLayoutProps } from './dashboardLayout.types';

export function DashboardLayout({
  navigation,
  topBar,
  children,
  sidebarFooter,
}: DashboardLayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#main"
        className="bg-surface text-fg shadow-popover sr-only z-50 rounded-lg px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <AppSidebar sections={navigation} brand={<BrandMark />} footer={sidebarFooter} />
      </aside>

      {/* Mobile drawer */}
      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="bg-overlay fixed inset-0 z-50 lg:hidden" />
          <Dialog.Content
            className="fixed inset-y-0 start-0 z-50 w-[min(17rem,85vw)] lg:hidden"
            style={{ boxShadow: 'var(--shadow-popover)' }}
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Description className="sr-only">Main navigation menu</Dialog.Description>
            <AppSidebar
              sections={navigation}
              brand={
                <div className="flex w-full items-center justify-between">
                  <BrandMark />
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label="Close navigation"
                      className="rounded-lg p-1 transition-colors hover:[background-color:var(--sidebar-hover-bg)]"
                      style={{ color: 'var(--sidebar-fg-muted)' }}
                    >
                      <X className="size-4" />
                    </button>
                  </Dialog.Close>
                </div>
              }
              footer={sidebarFooter}
              onNavigate={() => setDrawerOpen(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="bg-bg flex min-w-0 flex-col">
        <TopBar {...topBar} onMenuClick={() => setDrawerOpen(true)} />
        <main id="main" tabIndex={-1} className="page-gutter flex-1 py-6 outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
