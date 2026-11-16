import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CNICInput } from '../CNICInput';
import { PhoneInput } from './PhoneInput';

describe('PhoneInput', () => {
  it('formats as the user types and reports E.164 when valid', async () => {
    const onChange = vi.fn();
    render(<PhoneInput aria-label="Mobile" onChange={onChange} />);
    const input = screen.getByLabelText('Mobile');
    await userEvent.type(input, '03001234567');
    expect(input).toHaveValue('300 1234567');
    expect(onChange).toHaveBeenLastCalledWith({
      e164: '+923001234567',
      national: '3001234567',
      valid: true,
    });
  });

  it('reports invalid for numbers that are not mobiles', async () => {
    const onChange = vi.fn();
    render(<PhoneInput aria-label="Mobile" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Mobile'), '2134567890');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ e164: null, valid: false }),
    );
  });

  it('has no prefix dropdown — the full number is typed in one field', async () => {
    const onChange = vi.fn();
    render(<PhoneInput aria-label="Mobile" onChange={onChange} />);
    expect(screen.queryByLabelText('Original network allocation')).not.toBeInTheDocument();
    const input = screen.getByLabelText('Mobile');
    await userEvent.type(input, '03441234567');
    expect(input).toHaveValue('344 1234567');
    expect(onChange).toHaveBeenLastCalledWith({
      e164: '+923441234567',
      national: '3441234567',
      valid: true,
    });
  });

  it('keeps the +92 prefix locked and normalizes a pasted international number', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PhoneInput aria-label="Company mobile" onChange={onChange} />);

    const input = screen.getByLabelText('Company mobile');
    expect(screen.getByText('+92')).toBeInTheDocument();
    expect(screen.queryByLabelText('Original network allocation')).not.toBeInTheDocument();

    await user.click(input);
    fireEvent.change(input, { target: { value: '+923001234567' } });

    expect(input).toHaveValue('300 1234567');
    expect(onChange).toHaveBeenLastCalledWith({
      e164: '+923001234567',
      national: '3001234567',
      valid: true,
    });
  });
});

describe('CNICInput', () => {
  it('inserts dashes and reports completion', async () => {
    const onChange = vi.fn();
    render(<CNICInput aria-label="CNIC" onChange={onChange} />);
    const input = screen.getByLabelText('CNIC');
    await userEvent.type(input, '4210112345671');
    expect(input).toHaveValue('42101-1234567-1');
    expect(onChange).toHaveBeenLastCalledWith({
      digits: '4210112345671',
      formatted: '42101-1234567-1',
      complete: true,
    });
  });

  it('caps at 13 digits', async () => {
    render(<CNICInput aria-label="CNIC" />);
    const input = screen.getByLabelText('CNIC');
    await userEvent.type(input, '42101123456719999');
    expect(input).toHaveValue('42101-1234567-1');
  });
});
