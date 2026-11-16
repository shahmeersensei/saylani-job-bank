import type { SelectOption } from '@/components/atoms';
import type { InputProps } from '@/components/atoms/Input';

export interface SearchableSelectProps extends Omit<
  InputProps,
  'value' | 'defaultValue' | 'onChange' | 'type'
> {
  /** The selected option's code ('' = nothing selected). */
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}
