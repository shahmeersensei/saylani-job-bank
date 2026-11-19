'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const SEARCH_DELAY_MS = 350;

export function InstantListFilters({
  action,
  query,
  label,
  statuses,
  defaultStatus = '',
  allowAllStatuses = false,
  themeAware = false,
}: {
  action: string;
  query: string;
  label: string;
  statuses: readonly { value: string; label: string }[];
  defaultStatus?: string;
  allowAllStatuses?: boolean;
  themeAware?: boolean;
}) {
  const router = useRouter();
  const initial = new URLSearchParams(query);
  const [search, setSearch] = useState(initial.get('q') ?? '');
  const [status, setStatus] = useState(initial.get('status') ?? defaultStatus);
  const searchRef = useRef(search);
  const statusRef = useRef(status);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelSearch() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  function navigate(nextSearch: string, nextStatus: string) {
    const params = new URLSearchParams(window.location.search);
    params.delete('page');
    if (nextSearch.trim()) params.set('q', nextSearch.trim());
    else params.delete('q');
    if (nextStatus) params.set('status', nextStatus);
    else params.delete('status');
    const suffix = params.toString();
    router.replace(suffix ? `${action}?${suffix}` : action, { scroll: false });
  }

  useEffect(() => {
    function syncFromHistory() {
      cancelSearch();
      const params = new URLSearchParams(window.location.search);
      const nextSearch = params.get('q') ?? '';
      const nextStatus = params.get('status') ?? defaultStatus;
      searchRef.current = nextSearch;
      statusRef.current = nextStatus;
      setSearch(nextSearch);
      setStatus(nextStatus);
    }
    window.addEventListener('popstate', syncFromHistory);
    return () => {
      cancelSearch();
      window.removeEventListener('popstate', syncFromHistory);
    };
  }, [defaultStatus]);

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        cancelSearch();
        navigate(searchRef.current, statusRef.current);
      }}
    >
      <label className="grid gap-1 text-sm">
        Search {label}
        <input
          name="q"
          value={search}
          maxLength={200}
          onChange={(event) => {
            const value = event.currentTarget.value;
            searchRef.current = value;
            setSearch(value);
            cancelSearch();
            timer.current = setTimeout(() => {
              timer.current = null;
              navigate(searchRef.current, statusRef.current);
            }, SEARCH_DELAY_MS);
          }}
          className="border-border rounded border px-3 py-2"
        />
      </label>
      <label className="grid gap-1 text-sm">
        Status
        <select
          name="status"
          value={status}
          onChange={(event) => {
            const value = event.currentTarget.value;
            statusRef.current = value;
            setStatus(value);
            cancelSearch();
            navigate(searchRef.current, value);
          }}
          className={`border-border rounded border px-3 py-2 ${themeAware ? 'bg-surface text-fg' : ''}`}
        >
          {allowAllStatuses && (
            <option value="" className={themeAware ? 'bg-surface text-fg' : undefined}>
              All statuses
            </option>
          )}
          {statuses.map((item) => (
            <option
              key={item.value}
              value={item.value}
              className={themeAware ? 'bg-surface text-fg' : undefined}
            >
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
