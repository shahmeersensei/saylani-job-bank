'use client';

import { Bell, ChevronDown, Menu, Search, Command } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Avatar } from '@/components/atoms/Avatar';
import { Button } from '@/components/atoms/Button';
import { Select } from '@/components/atoms/Select';
import { cn } from '@/lib/utils/cn';
import type { TopBarProps } from './topBar.types';

export function TopBar({
  title,
  onMenuClick,
  branchSwitcher,
  user,
  userMenuItems = [],
  actions,
  className,
}: TopBarProps) {
  return (
    <header
      className={cn(
        'border-border bg-surface/95 page-gutter sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b backdrop-blur-sm',
        className,
      )}
      style={{ boxShadow: 'none' }}
    >
      {onMenuClick && (
        <Button
          variant="ghost"
          size="icon"
          className="-ms-2 lg:hidden"
          aria-label="Open navigation"
          onClick={onMenuClick}
        >
          <Menu />
        </Button>
      )}

      {/* Search bar — left-anchored */}
      <div className="hidden w-full max-w-xs md:flex">
        <label className="sr-only" htmlFor="topbar-search">
          Search
        </label>
        <div className="relative w-full">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            style={{ color: 'var(--fg-muted)' }}
            aria-hidden="true"
          />
          <input
            id="topbar-search"
            type="search"
            placeholder="Search…"
            className="w-full rounded-xl border py-2 pr-10 pl-9 text-sm transition-colors outline-none focus:ring-2"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface-muted)',
              color: 'var(--fg)',
            }}
          />
          <span
            className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-0.5 rounded px-1 py-0.5 font-mono text-xs"
            style={{ background: 'var(--surface-sunken)', color: 'var(--fg-muted)' }}
            aria-hidden="true"
          >
            <Command className="size-3" />K
          </span>
        </div>
      </div>

      {/* Spacer pushes right-side items to the end */}
      <div className="flex-1" />

      {/* Right-side: branch switcher + notifications + user */}
      {branchSwitcher && (
        <Select
          aria-label="Active branch"
          size="sm"
          wrapperClassName="w-auto max-w-44 sm:max-w-56"
          value={branchSwitcher.value}
          onChange={(event) => branchSwitcher.onChange(event.target.value)}
          options={branchSwitcher.branches.map((branch) => ({
            value: branch.id,
            label: branch.name,
          }))}
        />
      )}

      <div className="flex items-center gap-1">
        {actions}

        {/* Notification bell */}
        <button
          type="button"
          aria-label="Notifications"
          className="hover:bg-surface-muted focus-visible:focus-ring relative grid size-10 place-items-center rounded-lg transition-colors"
        >
          <Bell className="text-fg-muted size-[18px]" aria-hidden="true" />
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 size-2 rounded-full"
            style={{ backgroundColor: 'var(--primary)' }}
          />
        </button>
      </div>

      {user && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="hover:bg-surface-muted focus-visible:focus-ring flex items-center gap-2 rounded-xl p-1 pr-2 transition-colors"
              aria-label={`Account menu for ${user.name}`}
            >
              <Avatar name={user.name} src={user.avatarUrl} size="sm" />
              <span className="hidden text-start md:grid">
                <span className="text-fg max-w-40 truncate text-sm leading-tight font-semibold">
                  {user.name}
                </span>
                <span className="text-fg-muted text-xs leading-tight">{user.role}</span>
              </span>
              <ChevronDown className="text-fg-muted hidden size-4 md:block" aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className="border-border bg-surface shadow-popover z-40 min-w-52 rounded-xl border p-1"
            >
              <div className="border-border mb-1 border-b px-3 py-2.5 md:hidden">
                <p className="text-fg truncate text-sm font-semibold">{user.name}</p>
                <p className="text-fg-muted text-xs">{user.role}</p>
              </div>
              {userMenuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenu.Item
                    key={item.label}
                    onSelect={item.onSelect}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors outline-none select-none',
                      'data-[highlighted]:bg-surface-muted',
                      item.tone === 'danger' ? 'text-danger' : 'text-fg',
                    )}
                  >
                    {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
                    {item.label}
                  </DropdownMenu.Item>
                );
              })}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </header>
  );
}
