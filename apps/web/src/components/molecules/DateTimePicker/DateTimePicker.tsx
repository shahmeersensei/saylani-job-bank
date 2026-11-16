'use client';

import { Clock } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Input } from '@/components/atoms/Input';
import { DateInput } from '../DateInput';
import type { DateTimeMode, DateTimePickerProps } from './dateTimePicker.types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Converts a Date to the local value a native date/time input expects. */
export function toInputValue(date: Date, mode: DateTimeMode = 'datetime'): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (mode === 'date') return day;
  if (mode === 'time') return time;
  return `${day}T${time}`;
}

/**
 * Day-first date/time fields. The date part is a {@link DateInput} (typed
 * DD/MM/YYYY), never a native `<input type="date">`: the native control
 * renders mm/dd/yyyy on US-locale browsers, which is what the date-of-birth
 * field showed. Values stay local wall-clock strings in the native shapes
 * ("2026-10-01", "2026-10-01T14:30", "14:30"), so callers are unchanged.
 *
 * The time part keeps the native `<input type="time">` — it only ever shows
 * a time, so there is no day/month order to get wrong. It gets its own id:
 * the date input already takes the FormField label's id, and two controls
 * must not share one.
 */
export function DateTimePicker({
  mode = 'datetime',
  value,
  onChange,
  min,
  max,
  disabled,
  size,
  ...props
}: DateTimePickerProps) {
  const timeId = useId();

  // Datetime halves, kept locally until both are set (only used in datetime
  // mode): the parent value stays "" while either half is missing, so a
  // half-picked value must not be lost when the other half is picked next.
  // Declared up here so hook order never depends on `mode`.
  const [datePart, setDatePart] = useState(() => value?.slice(0, 10) ?? '');
  const [timePart, setTimePart] = useState(() =>
    value && value.length > 11 ? value.slice(11, 16) : '',
  );
  useEffect(() => {
    setDatePart(value?.slice(0, 10) ?? '');
    setTimePart(value && value.length > 11 ? value.slice(11, 16) : '');
  }, [value]);

  if (mode === 'date') {
    return (
      <DateInput
        value={value ?? ''}
        onChange={(iso) => onChange?.(iso)}
        min={min}
        max={max}
        disabled={disabled}
        size={size}
        {...props}
      />
    );
  }

  if (mode === 'time') {
    return (
      <Input
        type="time"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        startAdornment={<Clock aria-hidden="true" />}
        disabled={disabled}
        size={size}
        {...props}
      />
    );
  }

  // datetime: "YYYY-MM-DDTHH:mm" split across a DD/MM/YYYY date field and a time field.
  // The earliest time only binds when the picked day is the minimum day.
  const minDate = min?.slice(0, 10);
  const minTime = min && min.length > 11 && datePart === minDate ? min.slice(11, 16) : undefined;

  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <DateInput
          value={datePart}
          onChange={(iso) => {
            setDatePart(iso);
            onChange?.(iso && timePart ? `${iso}T${timePart}` : '');
          }}
          min={minDate}
          max={max?.slice(0, 10)}
          disabled={disabled}
          size={size}
          {...props}
        />
      </div>
      <div className="w-32 shrink-0">
        <Input
          type="time"
          id={timeId}
          aria-label="Time"
          value={timePart}
          min={minTime}
          onChange={(event) => {
            const time = event.target.value;
            setTimePart(time);
            onChange?.(datePart && time ? `${datePart}T${time}` : '');
          }}
          disabled={disabled}
          size={size}
        />
      </div>
    </div>
  );
}
