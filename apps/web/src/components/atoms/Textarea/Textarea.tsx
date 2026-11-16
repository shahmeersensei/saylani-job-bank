'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { useFieldControl } from '../FieldContext';
import { controlBase } from '../Input';
import type { TextareaProps } from './textarea.types';

export function Textarea({
  className,
  invalid,
  showCount,
  maxLength,
  id,
  required,
  disabled,
  value,
  defaultValue,
  onChange,
  rows = 4,
  'aria-describedby': ariaDescribedBy,
  ...props
}: TextareaProps) {
  const field = useFieldControl({
    id,
    invalid,
    required,
    disabled,
    'aria-describedby': ariaDescribedBy,
  });
  // As in Input: a standalone Textarea with no id renders with no id at
  // all, which Chrome flags. Generate one; a FormField id wins when present.
  const generatedId = useId();
  const controlId = field.id ?? generatedId;
  const [uncontrolledLength, setUncontrolledLength] = useState(String(defaultValue ?? '').length);
  const length = value !== undefined ? String(value).length : uncontrolledLength;

  return (
    <div className="w-full">
      <div className={cn(controlBase, 'px-3 py-2')}>
        <textarea
          id={controlId}
          rows={rows}
          required={field.required}
          disabled={field.disabled}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          aria-invalid={field['aria-invalid']}
          aria-describedby={field['aria-describedby']}
          onChange={(event) => {
            setUncontrolledLength(event.target.value.length);
            onChange?.(event);
          }}
          className={cn(
            'placeholder:text-fg-subtle block w-full resize-y bg-transparent text-sm outline-none',
            className,
          )}
          {...props}
        />
      </div>
      {showCount && maxLength !== undefined && (
        <p className="text-fg-subtle numeric mt-1 text-end text-xs" aria-live="polite">
          {length} / {maxLength}
        </p>
      )}
    </div>
  );
}
