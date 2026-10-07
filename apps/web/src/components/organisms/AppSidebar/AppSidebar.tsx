'use client';

import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import type { AppSidebarProps, NavItem } from './appSidebar.types';

export function isNavItemActive(item: Pick<NavItem, 'href' | 'exact'>, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AppSidebar({ sections, brand, footer, onNavigate, className }: AppSidebarProps) {
  const pathname = usePathname() ?? '';

  return (
    <div
      className={cn('flex h-full flex-col', className)}
      style={{
        backgroundColor: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
      }}
    >
      {/* Brand row */}
      {brand && (
        <div
          className="flex h-16 shrink-0 items-center px-5"
          style={{ borderBottom: '1px solid var(--sidebar-border)' }}
        >
          {brand}
        </div>
      )}

      {/* Nav */}
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-4 py-5">
        <div className="grid gap-6">
          {sections.map((section, sectionIndex) => (
            <div key={section.title ?? sectionIndex} className="grid gap-1">
              {section.title && (
                <p
                  className="px-2 pb-2 text-[10px] font-bold tracking-[0.1em] uppercase"
                  style={{ color: 'var(--sidebar-fg-muted)' }}
                >
                  {section.title}
                </p>
              )}
              <ul className="grid gap-0.5">
                {section.items.map((item) => {
                  const active = isNavItemActive(item, pathname);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <NextLink
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'focus-visible:focus-ring relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-100',
                          active
                            ? 'bg-[var(--sidebar-active-bg)]'
                            : 'hover:bg-[var(--sidebar-hover-bg)]',
                        )}
                        style={{ color: active ? 'var(--primary)' : 'var(--sidebar-fg)' }}
                      >
                        {/* Active left bar */}
                        {active && (
                          <span
                            aria-hidden="true"
                            className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full"
                            style={{ background: 'var(--primary)' }}
                          />
                        )}
                        <Icon
                          className="size-[18px] shrink-0"
                          aria-hidden="true"
                          style={{ color: active ? 'var(--primary)' : 'var(--sidebar-fg-muted)' }}
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge !== undefined && item.badge > 0 && (
                          <span
                            className="numeric rounded-full px-1.5 py-0.5 text-[11px] font-bold"
                            style={{
                              background: 'var(--surface-sunken)',
                              color: 'var(--fg-muted)',
                            }}
                          >
                            {item.badge > 99 ? '99+' : item.badge}
                            <span className="sr-only"> pending</span>
                          </span>
                        )}
                      </NextLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* Footer */}
      {footer && (
        <div className="shrink-0 p-4" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
          {footer}
        </div>
      )}
    </div>
  );
}
