'use client';

import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils/cn';
import type { OTPInputProps } from './otpInput.types';

export function OTPInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  invalid,
  autoFocus,
  label = 'Verification code',
  className,
}: OTPInputProps) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  // Latest committed value. Keystrokes can arrive faster than the parent re-renders
  // (fast typing, some mobile keyboards), so never compute from the stale `value` prop.
  const latest = useRef(value);
  latest.current = value;
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');
  const currentDigits = () => Array.from({ length }, (_, i) => latest.current[i] ?? '');

  const focus = (index: number) =>
    inputs.current[Math.max(0, Math.min(length - 1, index))]?.focus();

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    latest.current = clean;
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };

  const setDigitAt = (index: number, digit: string) => {
    const chars = currentDigits();
    chars[index] = digit;
    // Empty boxes collapse, so the value is always contiguous (like deleting a character).
    commit(chars.join(''));
  };

  const handleKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (currentDigits()[index]) setDigitAt(index, '');
      else if (index > 0) {
        setDigitAt(index - 1, '');
        focus(index - 1);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focus(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focus(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    commit(pasted);
    focus(pasted.length >= length ? length - 1 : pasted.length);
  };

  return (
    <div role="group" aria-label={label} className={cn('flex gap-2', className)}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputs.current[index] = el;
          }}
          type="text"
          id={`otp-digit-${index + 1}`}
          name={`otp-digit-${index + 1}`}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          pattern="\d*"
          // No maxLength: it would truncate an autofilled/inserted code (iOS puts the whole
          // SMS code into the first box) before onChange can spread it across the boxes.
          value={digit}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          aria-label={`Digit ${index + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          onFocus={(event) => event.target.select()}
          onKeyDown={handleKeyDown(index)}
          onPaste={handlePaste}
          onChange={(event) => {
            let typed = event.target.value.replace(/\D/g, '');
            if (!typed) return;
            // Typing into a filled box whose text was not selected yields old+new: keep the new digit.
            const previous = currentDigits()[index];
            if (previous && typed.length === 2 && typed.includes(previous)) {
              typed = typed[0] === previous ? typed[1]! : typed[0]!;
            }
            // Autofill / fast insertion: several digits arrive in one box.
            if (typed.length > 1) {
              commit(latest.current.slice(0, index) + typed);
              focus(index + typed.length);
              return;
            }
            // Typing past the first empty box fills that box instead (no gaps).
            const target = Math.min(index, latest.current.length);
            setDigitAt(target, typed);
            focus(target + 1);
          }}
          className={cn(
            'border-border-strong bg-surface text-fg numeric size-11 rounded-lg border text-center text-lg font-semibold sm:size-12',
            'focus-visible:border-focus focus-visible:focus-ring transition-colors disabled:opacity-50',
            invalid && 'border-danger',
          )}
        />
      ))}
    </div>
  );
}
