import type { PaginationMeta } from '@jobbank/shared';
import NextLink from 'next/link';
import { InstantListFilters } from './InstantListFilters';

export function branchListParams(
  input: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item) params.append(key, item);
    }
  }
  return params;
}

export function BranchListControls({
  action,
  params,
  meta,
  statuses,
  label,
  themeAware = false,
}: {
  action: string;
  params: URLSearchParams;
  meta: PaginationMeta;
  statuses: readonly { value: string; label: string }[];
  label: string;
  themeAware?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <InstantListFilters
        action={action}
        query={params.toString()}
        label={label}
        statuses={statuses}
        allowAllStatuses
        themeAware={themeAware}
      />
      <BranchListPagination action={action} params={params} meta={meta} label={label} />
    </div>
  );
}

export function BranchListPagination({
  action,
  params,
  meta,
  label,
}: {
  action: string;
  params: URLSearchParams;
  meta: PaginationMeta;
  label: string;
}) {
  const pageHref = (page: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(page));
    return `${action}?${next.toString()}`;
  };
  return (
    <div className="flex items-center gap-4 text-sm">
      <span>
        {meta.total} matching {label}
      </span>
      {meta.page > 1 && <NextLink href={pageHref(meta.page - 1)}>Previous</NextLink>}
      <span>
        Page {meta.page} of {Math.max(meta.pageCount, 1)}
      </span>
      {meta.page < meta.pageCount && <NextLink href={pageHref(meta.page + 1)}>Next</NextLink>}
    </div>
  );
}
