import type { InputProps } from '@/components/atoms/Input';

export interface DateInputProps extends Omit<
  InputProps,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max'
> {
  /**
   * ISO date "YYYY-MM-DD" (or "" when empty) — the storage format the
   * database, API and validation already expect. The user only ever sees
   * the DD/MM/YYYY display form.
   */
  value?: string;
  /** Called with the ISO date when the typed text is a real date in range, or "" when cleared/invalid. */
  onChange?: (isoDate: string) => void;
  /** Earliest date, ISO "YYYY-MM-DD". */
  min?: string;
  /** Latest date, ISO "YYYY-MM-DD". */
  max?: string;
}
