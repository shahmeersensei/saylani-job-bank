'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useFieldControl } from '../FieldContext';
import type { SelectProps } from './select.types';

const heights = { sm: 'h-8 text-sm', md: 'h-10 text-sm', lg: 'h-12 text-base' } as const;

/** Themed select shell: soft brand tint; solid green + white text on hover (light & dark). */
const selectShell = [
  'group w-full rounded-lg border border-primary/25 bg-primary-soft text-primary-soft-fg shadow-xs transition-colors',
  'hover:border-primary hover:bg-primary hover:text-primary-fg focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary/30',
  'has-[:is(input,select,textarea):disabled]:cursor-not-allowed has-[:is(input,select,textarea):disabled]:border-border has-[:is(input,select,textarea):disabled]:bg-surface-muted has-[:is(input,select,textarea):disabled]:text-fg-subtle has-[:is(input,select,textarea):disabled]:opacity-80 has-[:is(input,select,textarea):disabled]:hover:bg-surface-muted has-[:is(input,select,textarea):disabled]:hover:text-fg-subtle',
  'has-[[aria-invalid=true]]:border-danger has-[[aria-invalid=true]]:bg-danger-soft/40',
].join(' ');

const optionClass = 'bg-surface text-fg';

export function Select({
  options,
  placeholder,
  invalid,
  size = 'md',
  className,
  wrapperClassName,
  children,
  id,
  required,
  disabled,
  'aria-describedby': ariaDescribedBy,
  ...props
}: SelectProps) {
  const field = useFieldControl({
    id,
    invalid,
    required,
    disabled,
    'aria-describedby': ariaDescribedBy,
  });

  return (
    <div className={cn(selectShell, 'relative flex items-center', heights[size], wrapperClassName)}>
      <select
        id={field.id}
        required={field.required}
        disabled={field.disabled}
        aria-invalid={field['aria-invalid']}
        aria-describedby={field['aria-describedby']}
        className={cn(
          'h-full w-full cursor-pointer appearance-none bg-transparent ps-3 pe-9 outline-none disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      >
        {placeholder !== undefined && (
          <option value="" disabled={field.required} className={optionClass}>
            {placeholder}
          </option>
        )}
        {options?.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={optionClass}
          >
            {option.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown
        className="text-primary-soft-fg/70 group-hover:text-primary-fg/80 pointer-events-none absolute end-3 size-4 transition-colors"
        aria-hidden="true"
      />
    </div>
  );
}
