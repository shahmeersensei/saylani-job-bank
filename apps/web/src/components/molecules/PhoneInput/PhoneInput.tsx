'use client';

import { useState } from 'react';
import { Input } from '@/components/atoms/Input';
import {
  formatPkMobileNational,
  isSupportedPkMobile,
  normalizePkMobile,
  toNationalMobileDigits,
} from '@/lib/format/phone';
import type { PhoneInputProps } from './phoneInput.types';

/** Pakistani mobile number input with a fixed +92 prefix ("300 1234567"). */
export function PhoneInput({
  value,
  onChange,
  placeholder = '300 1234567',
  ...props
}: PhoneInputProps) {
  const [internal, setInternal] = useState(() => toNationalMobileDigits(value ?? ''));
  const national = value !== undefined ? toNationalMobileDigits(value) : internal;

  return (
    <Input
      type="tel"
      inputMode="numeric"
      autoComplete="tel-national"
      placeholder={placeholder}
      value={formatPkMobileNational(national)}
      onChange={(event) => {
        const next = toNationalMobileDigits(event.target.value);
        setInternal(next);
        const e164 = normalizePkMobile(next);
        // Audit 2026-11-11 (L-03): only emit E.164 for allowlisted
        // prefixes — any other 3xx shape is rejected by the server.
        const supported = e164 !== null && isSupportedPkMobile(e164);
        onChange?.({ e164: supported ? e164 : null, national: next, valid: supported });
      }}
      startAdornment={
        <span className="border-border text-fg-muted numeric border-e pe-2 text-sm font-medium">
          +92
        </span>
      }
      className="numeric"
      {...props}
    />
  );
}
