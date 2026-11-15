'use client';

import type { Holiday } from '@jobbank/shared';
import { CalendarDays, Plus } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Button, Input, Select, StatusPill, Switch } from '@/components/atoms';
import { DateTimePicker, EmptyState, FormField, Modal, toast } from '@/components/molecules';
import { DataTable } from '@/components/organisms';
import { ApiClientError, apiFetch, friendlyApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';

const weekday = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
const longDate = (date: string) => formatDate(`${date}T00:00:00Z`);

function HolidayDialog({
  holiday,
  trigger,
  open,
  onOpenChange,
}: {
  holiday?: Holiday;
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const fresh = () => ({
    date: holiday?.date ?? '',
    name: holiday?.name ?? '',
    isActive: holiday?.isActive ?? true,
  });
  const [form, setForm] = useState(fresh);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [innerOpen, setInnerOpen] = useState(false);

  const setOpen = (next: boolean) => {
    if (open === undefined) setInnerOpen(next);
    onOpenChange?.(next);
    if (!next) {
      setForm(fresh());
      setErrors({});
      setKey(crypto.randomUUID());
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      if (holiday) {
        await apiFetch(`/api/v1/holidays/${holiday.id}`, { method: 'PATCH', body: form });
      } else {
        await apiFetch('/api/v1/holidays', {
          method: 'POST',
          idempotencyKey: key,
          body: { date: form.date, name: form.name },
        });
      }
      toast.success(holiday ? 'Holiday saved' : `${form.name} added`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
        if (!err.issues.length) setErrors({ form: friendlyApiError(err) });
      } else setErrors({ form: 'Could not save the holiday' });
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={holiday ? 'Edit holiday' : 'Add holiday'}
      description="Holidays are skipped when counting working days for SLAs."
      open={open ?? innerOpen}
      onOpenChange={setOpen}
      trigger={trigger}
      size="sm"
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <FormField label="Date" required error={errors.date}>
          <DateTimePicker
            mode="date"
            value={form.date}
            onChange={(date) => setForm((f) => ({ ...f, date }))}
          />
        </FormField>
        <FormField label="Name" required error={errors.name}>
          <Input
            value={form.name}
            placeholder="e.g. Eid ul Fitr (day 1)"
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FormField>
        {holiday && (
          <Switch
            label="Active"
            description="Inactive holidays count as normal working days."
            checked={form.isActive}
            onCheckedChange={(on) => setForm((f) => ({ ...f, isActive: on }))}
          />
        )}
        {errors.form && (
          <p
            role="alert"
            className="bg-danger-soft text-danger-soft-fg rounded-lg px-3 py-2 text-sm"
          >
            {errors.form}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={!form.date || !form.name}>
            {holiday ? 'Save' : 'Add'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface Props {
  holidays: Holiday[];
  year: number;
  years: number[];
}

/** Public holidays for one year. Lunar holidays are added once announced. */
export function HolidaysManager({ holidays, year, years }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [editing, setEditing] = useState<Holiday | null>(null);

  return (
    <>
      <DataTable<Holiday>
        caption={`Holidays in ${year}`}
        rows={holidays}
        getRowId={(h) => h.id}
        onRowClick={setEditing}
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-3">
            <Select
              aria-label="Year"
              value={String(year)}
              onChange={(e) => router.push(`${pathname}?type=HOLIDAYS&year=${e.target.value}`)}
              options={years.map((y) => ({ value: String(y), label: String(y) }))}
              wrapperClassName="w-28"
            />
            <p className="text-fg-muted min-w-0 flex-1 text-sm">
              Islamic holidays depend on the moon: add them once the government announces the dates.
            </p>
            <HolidayDialog
              trigger={
                <Button leftIcon={<Plus />} className="ms-auto">
                  Add holiday
                </Button>
              }
            />
          </div>
        }
        empty={
          <EmptyState
            icon={CalendarDays}
            title={`No holidays in ${year}`}
            description="Add public holidays so SLAs skip them."
          />
        }
        columns={[
          {
            id: 'date',
            header: 'Date',
            cell: (h) => (
              <div className="grid">
                <span className="numeric font-medium">{longDate(h.date)}</span>
                <span className="text-fg-subtle text-xs">{weekday(h.date)}</span>
              </div>
            ),
          },
          { id: 'name', header: 'Holiday', cell: (h) => h.name },
          {
            id: 'status',
            header: 'Status',
            cell: (h) => (
              <StatusPill
                label={h.isActive ? 'Active' : 'Inactive'}
                tone={h.isActive ? 'success' : 'neutral'}
              />
            ),
          },
        ]}
      />
      {editing && (
        <HolidayDialog
          key={editing.id}
          holiday={editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
    </>
  );
}
