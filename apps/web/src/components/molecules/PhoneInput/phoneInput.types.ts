import type { InputProps } from '@/components/atoms/Input';

export interface PhoneChange {
  /** E.164 (+923XXXXXXXXX) when valid, otherwise null. */
  e164: string | null;
  /** The raw national digits typed so far (max 10). */
  national: string;
  valid: boolean;
}

export interface PhoneInputProps extends Omit<
  InputProps,
  'value' | 'defaultValue' | 'onChange' | 'type'
> {
  /** E.164 or national value; it is normalised for display. */
  value?: string;
  onChange?: (change: PhoneChange) => void;
}
