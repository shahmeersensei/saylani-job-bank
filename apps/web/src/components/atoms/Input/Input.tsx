'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils/cn';
import { useFieldControl } from '../FieldContext';
import type { InputProps } from './input.types';

const heights = { sm: 'h-8 text-sm', md: 'h-10 text-sm', lg: 'h-12 text-base' } as const;

/** Shared look for text-like controls (Input, Select, Textarea). */
export const controlBase = [
  'w-full rounded-lg border border-border-strong bg-surface text-fg shadow-xs',
  'placeholder:text-fg-subtle transition-colors',
  'focus-within:border-focus focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-focus/40',
  // Scoped to the control itself: a disabled placeholder <option> must not grey out a Select.
  'has-[:is(input,select,textarea):disabled]:cursor-not-allowed has-[:is(input,select,textarea):disabled]:bg-surface-muted has-[:is(input,select,textarea):disabled]:opacity-70',
  'has-[[aria-invalid=true]]:border-danger',
].join(' ');

export function Input({
  className,
  wrapperClassName,
  invalid,
  startAdornment,
  endAdornment,
  size = 'md',
  id,
  required,
  disabled,
  'aria-describedby': ariaDescribedBy,
  ...props
}: InputProps) {
  const field = useFieldControl({
    id,
    invalid,
    required,
    disabled,
    'aria-describedby': ariaDescribedBy,
  });
  // Standalone inputs (SearchBar, filter dates) have no FormField and no
  // id prop, so they rendered with no id at all — Chrome flags form fields
  // with neither an id nor a name. Generate one; inside a FormField the
  // context id wins, so labelled fields are unaffected.
  const generatedId = useId();
  const controlId = field.id ?? generatedId;

  return (
    <div
      className={cn(controlBase, 'flex items-center gap-2 px-3', heights[size], wrapperClassName)}
    >
      {startAdornment && (
        <span className="text-fg-muted flex shrink-0 items-center [&_svg]:size-4">
          {startAdornment}
        </span>
      )}
      <input
        id={controlId}
        required={field.required}
        disabled={field.disabled}
        aria-invalid={field['aria-invalid']}
        aria-describedby={field['aria-describedby']}
        className={cn(
          'placeholder:text-fg-subtle h-full min-w-0 flex-1 bg-transparent outline-none disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
      {endAdornment && (
        <span className="text-fg-muted flex shrink-0 items-center [&_svg]:size-4">
          {endAdornment}
        </span>
      )}
    </div>
  );
}
