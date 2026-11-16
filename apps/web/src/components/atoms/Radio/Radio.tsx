'use client';

import { RadioGroup as RadixRadioGroup } from 'radix-ui';
import { useId } from 'react';
import { cn } from '@/lib/utils/cn';
import { useFieldControl } from '../FieldContext';
import type { RadioGroupProps } from './radio.types';

export function RadioGroup({
  options,
  invalid,
  className,
  orientation = 'vertical',
  required,
  disabled,
  'aria-describedby': ariaDescribedBy,
  ...props
}: RadioGroupProps) {
  const field = useFieldControl({
    invalid,
    required,
    disabled,
    'aria-describedby': ariaDescribedBy,
  });
  // When a FormField wraps this group it renders <label htmlFor={field.id}>,
  // but the items used their own useId base, so no element carried that id
  // and Chrome flagged the label. The first option now carries the field id
  // exactly (the standard label-points-at-first-radio pattern); the rest
  // keep "{base}-{value}". Standalone groups (no FormField) are unchanged.
  const generatedId = useId();
  const baseId = field.id ?? generatedId;

  return (
    <RadixRadioGroup.Root
      orientation={orientation}
      required={field.required}
      disabled={field.disabled}
      aria-invalid={field['aria-invalid']}
      aria-describedby={field['aria-describedby']}
      className={cn(
        orientation === 'horizontal' ? 'flex flex-wrap gap-x-6 gap-y-3' : 'grid gap-3',
        className,
      )}
      {...props}
    >
      {options.map((option, index) => {
        const itemId = field.id && index === 0 ? field.id : `${baseId}-${option.value}`;
        return (
          <div key={option.value} className="flex items-start gap-3">
            <RadixRadioGroup.Item
              id={itemId}
              value={option.value}
              disabled={option.disabled}
              className={cn(
                'border-border-strong bg-surface mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
                'focus-visible:focus-ring transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                'data-[state=checked]:border-primary',
                invalid && 'border-danger',
              )}
            >
              <RadixRadioGroup.Indicator className="bg-primary size-2.5 rounded-full" />
            </RadixRadioGroup.Item>
            <div className="grid gap-0.5">
              <label htmlFor={itemId} className="text-fg cursor-pointer text-sm font-medium">
                {option.label}
              </label>
              {option.description && <p className="text-fg-muted text-sm">{option.description}</p>}
            </div>
          </div>
        );
      })}
    </RadixRadioGroup.Root>
  );
}
