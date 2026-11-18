import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DateInput } from './DateInput';
import type { DateInputProps } from './dateInput.types';

type HarnessProps = Omit<DateInputProps, 'value' | 'onChange'>;

/** Controlled harness: mirrors the ISO value back in, like every real caller. */
function renderDateInput(initial = '', props: HarnessProps = {}, label = 'Date of birth') {
  const onChange = vi.fn();
  function Wrapper() {
    const [value, setValue] = useState(initial);
    return (
      <DateInput
        aria-label={label}
        value={value}
        onChange={(iso) => {
          setValue(iso);
          onChange(iso);
        }}
        {...props}
      />
    );
  }
  render(<Wrapper />);
  return { onChange, input: screen.getByLabelText(label) };
}

describe('DateInput', () => {
  it('shows DD/MM/YYYY and auto-inserts slashes while typing', async () => {
    const { input, onChange } = renderDateInput();
    expect(input).toHaveAttribute('placeholder', 'DD/MM/YYYY');
    await userEvent.type(input, '12041998');
    expect(input).toHaveValue('12/04/1998');
    expect(onChange).toHaveBeenLastCalledWith('1998-04-12');
  });

  it('tolerates typed slashes and a pasted DD/MM/YYYY value', async () => {
    const { input, onChange } = renderDateInput();
    await userEvent.type(input, '12/04/1998');
    expect(input).toHaveValue('12/04/1998');
    expect(onChange).toHaveBeenLastCalledWith('1998-04-12');

    const { input: pasted, onChange: pastedChange } = renderDateInput('', {}, 'Pasted date');
    fireEvent.change(pasted, { target: { value: '12/04/1998' } });
    expect(pasted).toHaveValue('12/04/1998');
    expect(pastedChange).toHaveBeenLastCalledWith('1998-04-12');
  });

  it('displays a prefilled ISO value as DD/MM/YYYY', () => {
    const { input } = renderDateInput('1998-04-12');
    expect(input).toHaveValue('12/04/1998');
  });

  it('places the native date picker over the calendar icon', () => {
    renderDateInput();
    const datePicker = screen.getByLabelText('Open calendar');

    expect(datePicker).toHaveAttribute('type', 'date');
    expect(datePicker).not.toHaveClass('pointer-events-none');
    expect(datePicker).toHaveClass('absolute', 'size-full');
    expect(datePicker.parentElement?.parentElement?.previousElementSibling).toBe(
      screen.getByLabelText('Date of birth'),
    );
  });

  it('updates the displayed date when selected from the calendar', () => {
    const { input, onChange } = renderDateInput();
    const datePicker = document.querySelector<HTMLInputElement>('input[type="date"]');
    expect(datePicker).not.toBeNull();

    fireEvent.change(datePicker!, { target: { value: '2026-11-17' } });

    expect(input).toHaveValue('17/11/2026');
    expect(onChange).toHaveBeenLastCalledWith('2026-11-17');
  });

  it('drops an impossible date on blur instead of reporting it', async () => {
    const { input, onChange } = renderDateInput();
    await userEvent.type(input, '31022026');
    expect(input).toHaveValue('31/02/2026');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(input).toHaveValue('');
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('drops a date outside min/max on blur', async () => {
    const { input, onChange } = renderDateInput('', {
      min: '1940-01-01',
      max: '2008-11-16',
    });
    await userEvent.type(input, '01012020');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(input).toHaveValue('');
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('accepts a date inside min/max', async () => {
    const { input, onChange } = renderDateInput('', {
      min: '1940-01-01',
      max: '2008-11-16',
    });
    await userEvent.type(input, '12041998');
    expect(input).toHaveValue('12/04/1998');
    expect(onChange).toHaveBeenLastCalledWith('1998-04-12');
  });

  it('reports "" when cleared', async () => {
    const { input, onChange } = renderDateInput('1998-04-12');
    await userEvent.clear(input);
    expect(onChange).toHaveBeenCalledWith('');
  });
});
