'use client';

import {
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  JOB_TYPES,
  JOB_TYPE_LABELS,
  SHIFT_TYPES,
  SHIFT_TYPE_LABELS,
  type JobType,
  type PaginationMeta,
  type ShiftType,
} from '@jobbank/shared';
import { Briefcase, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Button, Input, Link, Select } from '@/components/atoms';
import { EmptyState, Pagination, SearchBar } from '@/components/molecules';
import type { SelectOption } from '@/components/atoms';
import type { JobListItem } from '@/domains/job';
import { formatDate } from '@/lib/format/date';
import {
  ActiveFilterChips,
  CheckboxFilterGroup,
  FilterSection,
  useFilterParams,
  type ActiveFilterChip,
} from '../filters';

const STATUS_BADGE: Record<
  string,
  { tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info' }
> = {
  DRAFT: { tone: 'neutral' },
  OPEN: { tone: 'success' },
  PAUSED: { tone: 'warning' },
  FILLED: { tone: 'success' },
  CLOSED: { tone: 'neutral' },
  EXPIRED: { tone: 'danger' },
};

const FILTER_KEYS = [
  'status',
  'jobType',
  'categoryCode',
  'cityCode',
  'shift',
  'salaryMin',
  'salaryMax',
] as const;

const SORT_OPTIONS = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'title:asc', label: 'Title A–Z' },
  { value: 'vacancies:desc', label: 'Most vacancies' },
];

const pkr = (n: number) => `Rs ${n.toLocaleString('en-US')}`;

/** Daraz-style min/max box: digits only, blank means "no bound". */
const cleanSalary = (raw: string) => {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? String(n) : null;
};

interface Props {
  items: JobListItem[];
  pagination: PaginationMeta;
  categories: SelectOption[];
  cities: SelectOption[];
  basePath: string;
}

export function JobsTable({ items, pagination, categories, cities, basePath }: Props) {
  const params = useSearchParams();
  const { values, update, toggle, setValue, clearKeys } = useFilterParams();

  const selectedStatuses = values('status');
  const selectedTypes = values('jobType');
  const selectedCategories = values('categoryCode');
  const selectedCities = values('cityCode');
  const selectedShifts = values('shift');
  const salaryMin = params.get('salaryMin');
  const salaryMax = params.get('salaryMax');

  // Salary boxes are local until Apply, like Daraz's price range — but they
  // re-sync from the URL whenever a filter changes elsewhere (e.g. a chip).
  const [salaryMinInput, setSalaryMinInput] = useState(salaryMin ?? '');
  const [salaryMaxInput, setSalaryMaxInput] = useState(salaryMax ?? '');
  useEffect(() => setSalaryMinInput(params.get('salaryMin') ?? ''), [params]);
  useEffect(() => setSalaryMaxInput(params.get('salaryMax') ?? ''), [params]);
  const salaryMinClean = cleanSalary(salaryMinInput);
  const salaryMaxClean = cleanSalary(salaryMaxInput);
  const salaryInvalid =
    salaryMinClean !== null &&
    salaryMaxClean !== null &&
    Number(salaryMinClean) > Number(salaryMaxClean);

  const activeCount =
    selectedStatuses.length +
    selectedTypes.length +
    selectedCategories.length +
    selectedCities.length +
    selectedShifts.length +
    (salaryMin ? 1 : 0) +
    (salaryMax ? 1 : 0);
  const [filtersOpen, setFiltersOpen] = useState(activeCount > 0);

  const labelFor = (options: SelectOption[], value: string) =>
    options.find((o) => o.value === value)?.label ?? value;

  const chips: ActiveFilterChip[] = [
    ...selectedStatuses.map((v) => ({
      key: 'status',
      value: v,
      label: `Status: ${JOB_STATUS_LABELS[v as keyof typeof JOB_STATUS_LABELS] ?? v}`,
    })),
    ...selectedTypes.map((v) => ({
      key: 'jobType',
      value: v,
      label: `Type: ${JOB_TYPE_LABELS[v as JobType] ?? v}`,
    })),
    ...selectedCategories.map((v) => ({
      key: 'categoryCode',
      value: v,
      label: `Category: ${labelFor(categories, v)}`,
    })),
    ...selectedCities.map((v) => ({
      key: 'cityCode',
      value: v,
      label: `City: ${labelFor(cities, v)}`,
    })),
    ...selectedShifts.map((v) => ({
      key: 'shift',
      value: v,
      label: `Shift: ${SHIFT_TYPE_LABELS[v as ShiftType] ?? v}`,
    })),
    ...(salaryMin
      ? [{ key: 'salaryMin', value: salaryMin, label: `Salary from ${pkr(Number(salaryMin))}` }]
      : []),
    ...(salaryMax
      ? [{ key: 'salaryMax', value: salaryMax, label: `Salary up to ${pkr(Number(salaryMax))}` }]
      : []),
  ];

  const removeChip = (chip: ActiveFilterChip) => {
    if (chip.key === 'salaryMin' || chip.key === 'salaryMax') setValue(chip.key, null);
    else toggle(chip.key, chip.value);
  };

  const applySalary = () => {
    if (salaryInvalid) return;
    update({ salaryMin: salaryMinClean, salaryMax: salaryMaxClean });
  };

  const filterSections = (
    <>
      <FilterSection title="Status" selectedCount={selectedStatuses.length}>
        <CheckboxFilterGroup
          options={JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] }))}
          values={selectedStatuses}
          onToggle={(v) => toggle('status', v)}
        />
      </FilterSection>
      <FilterSection title="Job type" selectedCount={selectedTypes.length}>
        <CheckboxFilterGroup
          options={JOB_TYPES.map((t) => ({ value: t, label: JOB_TYPE_LABELS[t as JobType] }))}
          values={selectedTypes}
          onToggle={(v) => toggle('jobType', v)}
        />
      </FilterSection>
      <FilterSection title="Category" selectedCount={selectedCategories.length}>
        <CheckboxFilterGroup
          options={categories}
          values={selectedCategories}
          onToggle={(v) => toggle('categoryCode', v)}
        />
      </FilterSection>
      <FilterSection title="City" selectedCount={selectedCities.length}>
        <CheckboxFilterGroup
          options={cities}
          values={selectedCities}
          onToggle={(v) => toggle('cityCode', v)}
        />
      </FilterSection>
      <FilterSection title="Shift" selectedCount={selectedShifts.length}>
        <CheckboxFilterGroup
          options={SHIFT_TYPES.map((s) => ({ value: s, label: SHIFT_TYPE_LABELS[s as ShiftType] }))}
          values={selectedShifts}
          onToggle={(v) => toggle('shift', v)}
        />
      </FilterSection>
      <FilterSection
        title="Salary (PKR / month)"
        selectedCount={(salaryMin ? 1 : 0) + (salaryMax ? 1 : 0)}
      >
        <div className="grid gap-2 px-1 py-1">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              aria-label="Minimum salary"
              placeholder="Min"
              value={salaryMinInput}
              onChange={(e) => setSalaryMinInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySalary();
              }}
            />
            <span className="text-fg-muted text-xs" aria-hidden="true">
              –
            </span>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              aria-label="Maximum salary"
              placeholder="Max"
              value={salaryMaxInput}
              onChange={(e) => setSalaryMaxInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySalary();
              }}
            />
          </div>
          {salaryInvalid && (
            <p className="text-danger text-xs">Minimum must not be more than maximum.</p>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={applySalary}
            disabled={salaryInvalid}
          >
            Apply salary range
          </Button>
          <p className="text-fg-muted text-xs">Jobs with no salary listed are not shown.</p>
        </div>
      </FilterSection>
    </>
  );

  return (
    <div className="grid min-w-0 content-start gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBar
          className="w-full sm:max-w-xs"
          defaultValue={params.get('q') ?? ''}
          onSearch={(q) => setValue('q', q || null)}
          placeholder="Job title, company or keyword…"
          label="Search jobs"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls="job-filters"
        >
          <SlidersHorizontal className="mr-1.5 size-4" aria-hidden="true" />
          Filters
          {activeCount > 0 && (
            <span className="bg-primary text-primary-fg ms-1.5 grid size-5 place-items-center rounded-full text-xs font-semibold">
              {activeCount}
            </span>
          )}
        </Button>
        <Select
          aria-label="Sort jobs"
          wrapperClassName="w-full sm:w-44"
          value={params.get('sort') ?? 'createdAt:desc'}
          onChange={(e) => update({ sort: e.target.value })}
          options={SORT_OPTIONS}
        />
        <span className="text-fg-muted ms-auto text-sm">
          {pagination.total} {pagination.total === 1 ? 'job' : 'jobs'}
        </span>
      </div>
      {filtersOpen && (
        <div id="job-filters" className="border-border bg-surface rounded-xl border p-4">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Filters</h2>
            <button
              type="button"
              onClick={() => clearKeys(FILTER_KEYS)}
              disabled={activeCount === 0}
              className="focus-visible:focus-ring text-primary ms-auto rounded-sm text-xs font-semibold hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
            >
              Clear all
            </button>
          </div>
          <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">{filterSections}</div>
        </div>
      )}
      <ActiveFilterChips
        chips={chips}
        onRemove={removeChip}
        onClearAll={() => clearKeys(FILTER_KEYS)}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={activeCount > 0 || params.get('q') ? 'No jobs match these filters' : 'No jobs yet'}
          description={
            activeCount > 0 || params.get('q')
              ? 'Try clearing the filters or searching by a different title or company.'
              : 'Jobs posted by employers will appear here.'
          }
        />
      ) : (
        <div className="grid gap-3">
          {items.map((job) => {
            const pill = STATUS_BADGE[job.status] ?? { tone: 'neutral' as const };
            const meta = [
              job.companyName,
              job.cityLabel,
              JOB_TYPE_LABELS[job.jobType as JobType],
              `${job.vacancies} ${job.vacancies === 1 ? 'vacancy' : 'vacancies'}`,
              `Posted ${formatDate(job.createdAt)}`,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Link
                key={job.id}
                href={`${basePath}/${job.id}`}
                variant="unstyled"
                className="border-border bg-surface hover:bg-surface-muted flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <Briefcase className="text-fg-muted mt-0.5 size-5 shrink-0" />
                  <div>
                    <p className="text-fg font-medium">{job.title}</p>
                    <p className="text-fg-muted text-sm">{meta}</p>
                  </div>
                </div>
                <Badge tone={pill.tone}>{JOB_STATUS_LABELS[job.status]}</Badge>
              </Link>
            );
          })}
        </div>
      )}

      <Pagination
        page={pagination.page}
        pageCount={pagination.pageCount}
        pageSize={pagination.pageSize}
        total={pagination.total}
        onPageChange={(p) => update({ page: String(p) })}
      />
    </div>
  );
}
