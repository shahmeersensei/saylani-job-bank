'use client';

import { useState } from 'react';
import { Select } from '@/components/atoms';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

interface Props {
  value: string; // '' | 'YYYY-MM'
  onChange: (v: string) => void;
  placeholder?: string;
  /** Earliest selectable year (default: currentYear - 50) */
  minYear?: number;
  /** Latest selectable year (default: currentYear + 15) */
  maxYear?: number;
}

export function MonthYearPicker({
  value,
  onChange,
  placeholder = 'Month',
  minYear,
  maxYear,
}: Props) {
  const currentYear = new Date().getFullYear();
  const from = minYear ?? currentYear - 50;
  const to = maxYear ?? currentYear + 15;
  const years = Array.from({ length: to - from + 1 }, (_, i) => from + i);

  const [draft, setDraft] = useState<{ mm: string; yyyy: string }>(() => {
    if (value) {
      const [y, m] = value.split('-');
      return { yyyy: y ?? '', mm: m ?? '' };
    }
    return { mm: '', yyyy: '' };
  });

  const update = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (next.yyyy && next.mm) onChange(`${next.yyyy}-${next.mm}`);
    else onChange('');
  };

  return (
    <div className="flex gap-2">
      <Select
        value={draft.mm}
        onChange={(e) => update({ mm: e.target.value })}
        options={MONTHS.map((label, idx) => ({
          value: String(idx + 1).padStart(2, '0'),
          label,
        }))}
        placeholder={placeholder}
        wrapperClassName="flex-1"
      />
      <Select
        value={draft.yyyy}
        onChange={(e) => update({ yyyy: e.target.value })}
        options={years.map((y) => ({ value: String(y), label: String(y) }))}
        placeholder="Year"
        wrapperClassName="w-28"
      />
    </div>
  );
}
