'use client';

import { APPLICANT_STATUSES, IDENTITY_STATUSES, type PaginationMeta } from '@jobbank/shared';
import { Contact, SlidersHorizontal } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button, StatusPill } from '@/components/atoms';
import { DateTimePicker, EmptyState, SearchBar } from '@/components/molecules';
import { DataTable, type SortState } from '@/components/organisms';
import type { SelectOption } from '@/components/atoms';
import type { ApplicantListItem } from '@/domains/applicant';
import { formatDate } from '@/lib/format/date';
import {
  ActiveFilterChips,
  CheckboxFilterGroup,
  FilterSection,
  useFilterParams,
  type ActiveFilterChip,
} from '../filters';
import { APPLICANT_STATUS_PILL, IDENTITY_PILL } from './labels';

export interface CityOption extends SelectOption {
  /** Master-data row id; areas link to their city through this. */
  id: string;
}

export interface AreaOption extends SelectOption {
  /** Master-data row id of the parent city. */
  parentId: string | null;
}

interface Props {
  rows: ApplicantListItem[];
  meta: PaginationMeta;
  sort: SortState;
  /** Shown only when the viewer can see more than one branch. */
  branches: SelectOption[];
  skills: SelectOption[];
  cities: CityOption[];
  areas: AreaOption[];
}

const FILTER_KEYS = [
  'status',
  'identityStatus',
  'skillCode',
  'branchId',
  'cityCode',
  'areaCode',
  'createdFrom',
  'createdTo',
] as const;

export function ApplicantsTable({ rows, meta, sort, branches, skills, cities, areas }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { values, update, toggle, setValue, clearKeys } = useFilterParams();

  const selectedStatuses = values('status');
  const selectedIdentities = values('identityStatus');
  const selectedSkills = values('skillCode');
  const selectedBranches = values('branchId');
  const selectedCities = values('cityCode');
  const selectedAreas = values('areaCode');
  const createdFrom = params.get('createdFrom');
  const createdTo = params.get('createdTo');

  const activeCount =
    selectedStatuses.length +
    selectedIdentities.length +
    selectedSkills.length +
    selectedBranches.length +
    selectedCities.length +
    selectedAreas.length +
    (createdFrom ? 1 : 0) +
    (createdTo ? 1 : 0);
  const [filtersOpen, setFiltersOpen] = useState(activeCount > 0);

  const labelFor = (options: SelectOption[], value: string) =>
    options.find((o) => o.value === value)?.label ?? value;

  const chips: ActiveFilterChip[] = [
    ...selectedStatuses.map((v) => ({
      key: 'status',
      value: v,
      label: `Status: ${APPLICANT_STATUS_PILL[v as keyof typeof APPLICANT_STATUS_PILL]?.label ?? v}`,
    })),
    ...selectedIdentities.map((v) => ({
      key: 'identityStatus',
      value: v,
      label: `Identity: ${IDENTITY_PILL[v as keyof typeof IDENTITY_PILL]?.label ?? v}`,
    })),
    ...selectedSkills.map((v) => ({
      key: 'skillCode',
      value: v,
      label: `Skill: ${labelFor(skills, v)}`,
    })),
    ...selectedBranches.map((v) => ({
      key: 'branchId',
      value: v,
      label: `Branch: ${labelFor(branches, v)}`,
    })),
    ...selectedCities.map((v) => ({
      key: 'cityCode',
      value: v,
      label: `City: ${labelFor(cities, v)}`,
    })),
    ...selectedAreas.map((v) => ({
      key: 'areaCode',
      value: v,
      label: `Area: ${labelFor(areas, v)}`,
    })),
    ...(createdFrom
      ? [{ key: 'createdFrom', value: createdFrom, label: `From ${formatDate(createdFrom)}` }]
      : []),
    ...(createdTo
      ? [{ key: 'createdTo', value: createdTo, label: `To ${formatDate(createdTo)}` }]
      : []),
  ];

  const removeChip = (chip: ActiveFilterChip) => {
    if (chip.key === 'createdFrom' || chip.key === 'createdTo') setValue(chip.key, null);
    else toggle(chip.key, chip.value);
  };

  // Areas belong to cities: ticking a city off drops areas that no longer belong
  // to any selected city, so the filters can never hold an impossible pair.
  const toggleCity = (cityCode: string) => {
    const next = selectedCities.includes(cityCode)
      ? selectedCities.filter((v) => v !== cityCode)
      : [...selectedCities, cityCode];
    const nextCityIds = new Set(cities.filter((c) => next.includes(c.value)).map((c) => c.id));
    const keptAreas = selectedAreas.filter((code) => {
      const area = areas.find((a) => a.value === code);
      return area?.parentId && nextCityIds.has(area.parentId);
    });
    update({
      cityCode: next.length > 0 ? next : null,
      areaCode: keptAreas.length > 0 ? keptAreas : null,
    });
  };
  const areaOptions =
    selectedCities.length > 0
      ? areas.filter((a) =>
          cities.filter((c) => selectedCities.includes(c.value)).some((c) => c.id === a.parentId),
        )
      : [];

  const filterSections = (
    <>
      <FilterSection title="Status" selectedCount={selectedStatuses.length}>
        <CheckboxFilterGroup
          options={APPLICANT_STATUSES.map((s) => ({
            value: s,
            label: APPLICANT_STATUS_PILL[s].label,
          }))}
          values={selectedStatuses}
          onToggle={(v) => toggle('status', v)}
        />
      </FilterSection>
      <FilterSection title="Identity check" selectedCount={selectedIdentities.length}>
        <CheckboxFilterGroup
          options={IDENTITY_STATUSES.map((s) => ({
            value: s,
            label: IDENTITY_PILL[s].label,
          }))}
          values={selectedIdentities}
          onToggle={(v) => toggle('identityStatus', v)}
        />
      </FilterSection>
      <FilterSection title="Skill" selectedCount={selectedSkills.length}>
        <CheckboxFilterGroup
          options={skills}
          values={selectedSkills}
          onToggle={(v) => toggle('skillCode', v)}
        />
      </FilterSection>
      {branches.length > 1 && (
        <FilterSection title="Branch" selectedCount={selectedBranches.length}>
          <CheckboxFilterGroup
            options={branches}
            values={selectedBranches}
            onToggle={(v) => toggle('branchId', v)}
          />
        </FilterSection>
      )}
      <FilterSection title="City" selectedCount={selectedCities.length}>
        <CheckboxFilterGroup options={cities} values={selectedCities} onToggle={toggleCity} />
      </FilterSection>
      <FilterSection title="Area" selectedCount={selectedAreas.length}>
        <CheckboxFilterGroup
          options={areaOptions}
          values={selectedAreas}
          onToggle={(v) => toggle('areaCode', v)}
          disabled={selectedCities.length === 0}
          disabledHint="Choose a city first to see its areas."
        />
      </FilterSection>
      <FilterSection title="Registered" selectedCount={(createdFrom ? 1 : 0) + (createdTo ? 1 : 0)}>
        <div className="grid gap-2 px-1 py-1">
          <label className="grid gap-1 text-xs font-medium">
            From
            <DateTimePicker
              mode="date"
              aria-label="Registered from"
              value={createdFrom ?? ''}
              onChange={(iso) => setValue('createdFrom', iso || null)}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            To
            <DateTimePicker
              mode="date"
              aria-label="Registered to"
              value={createdTo ?? ''}
              onChange={(iso) => setValue('createdTo', iso || null)}
            />
          </label>
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
          placeholder="Name, CNIC, mobile or area…"
          label="Search applicants"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls="applicant-filters"
        >
          <SlidersHorizontal className="mr-1.5 size-4" aria-hidden="true" />
          Filters
          {activeCount > 0 && (
            <span className="bg-primary text-primary-fg ms-1.5 grid size-5 place-items-center rounded-full text-xs font-semibold">
              {activeCount}
            </span>
          )}
        </Button>
        <span className="text-fg-muted ms-auto text-sm">
          {meta.total} {meta.total === 1 ? 'applicant' : 'applicants'}
        </span>
      </div>
      {filtersOpen && (
        <div id="applicant-filters" className="border-border bg-surface rounded-xl border p-4">
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
      <DataTable<ApplicantListItem>
        caption="Applicants"
        rows={rows}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={(s) => update({ sort: `${s.id}:${s.direction}` })}
        onRowClick={(r) => router.push(`${pathname}/${r.id}`)}
        empty={
          <EmptyState
            icon={Contact}
            title="No applicants found"
            description="Try clearing the filters or searching by CNIC or mobile number."
          />
        }
        pagination={{
          page: meta.page,
          pageCount: meta.pageCount,
          pageSize: meta.pageSize,
          total: meta.total,
          onPageChange: (p) => update({ page: String(p) }),
        }}
        columns={[
          {
            id: 'fullName',
            header: 'Name',
            sortable: true,
            cell: (r) => (
              <div className="grid min-w-0">
                <span className="truncate font-medium">{r.fullName}</span>
                <span className="text-fg-subtle numeric truncate text-xs">
                  {r.cnicMasked}
                  {r.phoneMasked ? ` · ${r.phoneMasked}` : ''}
                </span>
              </div>
            ),
          },
          {
            id: 'area',
            header: 'Area',
            hideBelow: 'md',
            cell: (r) =>
              r.areaLabel || r.cityLabel ? (
                [r.areaLabel, r.cityLabel].filter(Boolean).join(', ')
              ) : (
                <span className="text-fg-subtle">No location yet</span>
              ),
          },
          ...(branches.length > 1
            ? [
                {
                  id: 'branch',
                  header: 'Branch',
                  hideBelow: 'lg' as const,
                  cell: (r: ApplicantListItem) =>
                    r.branchName ?? <span className="text-fg-subtle">Not chosen</span>,
                },
              ]
            : []),
          {
            id: 'profileCompleteness',
            header: 'Profile',
            sortable: true,
            hideBelow: 'sm',
            cell: (r) => <span className="numeric">{r.profileCompleteness}%</span>,
          },
          {
            id: 'identity',
            header: 'Identity',
            hideBelow: 'md',
            cell: (r) => <StatusPill {...IDENTITY_PILL[r.identityStatus]} />,
          },
          {
            id: 'createdAt',
            header: 'Registered',
            sortable: true,
            hideBelow: 'lg',
            cell: (r) => formatDate(r.createdAt),
          },
          {
            id: 'status',
            header: 'Status',
            cell: (r) => <StatusPill {...APPLICANT_STATUS_PILL[r.status]} />,
          },
        ]}
      />
    </div>
  );
}
