'use client';

import { CalendarDays } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/components/atoms/Input';
import { ddMmYyyyToIso, isoToDdMmYyyy } from '@/lib/format/date';
import type { DateInputProps } from './dateInput.types';

const DIGITS_ONLY = /\D/g;

/** "12041998" -> "12/04/1998", progressively ("12", "12/04", …) while typing. */
function formatDigits(digits: string): string {
  const d = digits.slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/**
 * Day-first date field. The user types DD/MM/YYYY — digits auto-format with
 * slashes as they type, so the field can never show mm/dd/yyyy no matter
 * what locale the browser runs in (a native `<input type="date">` follows
 * the browser locale, which is what put mm/dd/yyyy on the date-of-birth
 * field). The parent keeps the ISO YYYY-MM-DD value, so the API, database
 * and validation (age rules, min/max) are untouched.
 *
 * Partial text never overwrites the parent value; only a complete, real,
 * in-range date is reported. On blur, text that is not a real in-range date
 * is dropped (and the parent cleared) so a stale or mistyped date can never
 * be submitted.
 */
export function DateInput({
  value,
  onChange,
  min,
  max,
  placeholder = 'DD/MM/YYYY',
  onBlur,
  onFocus,
  disabled,
  ...props
}: DateInputProps) {
  const [text, setText] = useState(() => isoToDdMmYyyy(value ?? ''));
  const [focused, setFocused] = useState(false);

  // Keep the visible text in step when the parent value changes elsewhere
  // (form reset, prefilled token data) — but never while the user is typing.
  useEffect(() => {
    if (!focused) setText(isoToDdMmYyyy(value ?? ''));
  }, [value, focused]);

  // ISO dates compare chronologically as plain strings ("YYYY-MM-DD").
  const inRange = (iso: string) => !((min && iso < min) || (max && iso > max));

  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={10}
      placeholder={placeholder}
      value={text}
      endAdornment={
        <span className="text-fg-muted relative inline-flex items-center">
          <CalendarDays aria-hidden="true" />
          <input
            type="date"
            aria-label="Open calendar"
            value={value ?? ''}
            min={min}
            max={max}
            disabled={disabled}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            onChange={(event) => {
              const iso = event.target.value;
              if (!inRange(iso)) return;
              setText(isoToDdMmYyyy(iso));
              onChange?.(iso);
            }}
          />
        </span>
      }
      className="numeric tracking-wide"
      wrapperClassName="relative"
      disabled={disabled}
      {...props}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
        // Drop text that never became a real in-range date, so the parent
        // value (cleared below) and the visible text agree on submit.
        if (text.trim() !== '') {
          const iso = ddMmYyyyToIso(text);
          if (iso === null || !inRange(iso)) {
            setText('');
            onChange?.('');
          }
        }
      }}
      onChange={(event) => {
        const digits = event.target.value.replace(DIGITS_ONLY, '').slice(0, 8);
        const next = formatDigits(digits);
        setText(next);
        if (digits.length === 0) {
          onChange?.('');
          return;
        }
        if (digits.length === 8) {
          const iso = ddMmYyyyToIso(next);
          if (iso && inRange(iso)) onChange?.(iso);
        }
      }}
    />
  );
}
