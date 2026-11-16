'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Input } from '@/components/atoms';
import { cn } from '@/lib/utils/cn';
import type { SearchableSelectProps } from './searchableSelect.types';

/**
 * Type-to-filter select for long option lists (areas, skills): staff type
 * a few letters, the list narrows to matches, and picking one stores its
 * code.
 * Free text is never stored — clearing the text clears the value, and
 * leaving the field with unmatched text reverts to the selected label.
 * Focusing selects the current label, so typing replaces it.
 */
export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  ...props
}: SearchableSelectProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedLabel = options.find((option) => option.value === value)?.label ?? '';
  const [query, setQuery] = useState(selectedLabel);

  // Keep the text in sync when the value changes from outside the field
  // (prefill, form reset, a pick landing).
  useEffect(() => {
    setQuery(selectedLabel);
    setDirty(false);
  }, [value, selectedLabel]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // Before staff type, the list shows everything; once they type, it
  // narrows to labels containing the text.
  const filter = dirty ? query.trim().toLowerCase() : '';
  const filtered = filter
    ? options.filter((option) => option.label.toLowerCase().includes(filter))
    : options;
  const active = activeIndex >= 0 && activeIndex < filtered.length ? activeIndex : -1;
  const activeId = active >= 0 ? `${listId}-option-${active}` : undefined;

  const cancelScheduledClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const close = () => {
    cancelScheduledClose();
    setOpen(false);
    setQuery(selectedLabel);
    setDirty(false);
    setActiveIndex(-1);
  };

  const pick = (option: (typeof options)[number]) => {
    if (option.disabled) return;
    onChange(option.value);
    close();
  };

  const handleChange = (text: string) => {
    let next = text;
    if (!dirty) {
      // The field showed the selected label, which is not editable text:
      // the first keystroke starts a fresh search, whether or not the
      // browser replaced the selection on focus.
      if (selectedLabel && text.startsWith(selectedLabel)) {
        next = text.slice(selectedLabel.length);
      } else if (selectedLabel && selectedLabel.startsWith(text)) {
        // Backspace into the label clears the search (and the selection).
        next = '';
      }
    }
    setQuery(next);
    setDirty(true);
    setOpen(true);
    setActiveIndex(-1);
    // Clearing the text clears the selection — there is nothing to match.
    if (next === '' && value !== '') onChange('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((current) => (current + 1) % Math.max(filtered.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((current) => (current <= 0 ? filtered.length - 1 : current - 1));
    } else if (event.key === 'Enter') {
      const match =
        active >= 0 ? filtered[active] : filtered.length === 1 ? filtered[0] : undefined;
      if (open && match) {
        event.preventDefault();
        pick(match);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div className="relative w-full">
      <Input
        {...props}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={query}
        onChange={(event) => handleChange(event.target.value)}
        onFocus={(event) => {
          if (disabled) return;
          cancelScheduledClose();
          setDirty(false);
          setActiveIndex(-1);
          setOpen(true);
          event.currentTarget.select();
        }}
        onBlur={() => {
          // Let a pointer pick land first (same 150 ms as GeocodeAddressPicker).
          // Typing a full label and leaving the field picks that option.
          closeTimer.current = setTimeout(() => {
            const exact = options.find(
              (option) => option.label.toLowerCase() === query.trim().toLowerCase(),
            );
            if (exact && exact.value !== value) onChange(exact.value);
            close();
          }, 150);
        }}
        onKeyDown={handleKeyDown}
        endAdornment={<ChevronDown aria-hidden="true" />}
      />
      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          className="border-border bg-surface absolute top-full z-10 mt-1 max-h-60 w-full overflow-auto rounded-xl border shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="text-fg-muted px-4 py-2.5 text-sm">
              No matches — try a different spelling.
            </li>
          ) : (
            filtered.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled}
                onMouseDown={(event) => {
                  // The whole row is clickable; keep focus in the field so
                  // blur does not close the list first.
                  event.preventDefault();
                  pick(option);
                }}
                className={cn(
                  'cursor-pointer px-4 py-2.5 text-sm',
                  option.disabled && 'cursor-not-allowed opacity-50',
                  index === active
                    ? 'bg-primary-soft text-primary-soft-fg'
                    : 'hover:bg-surface-muted',
                )}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
