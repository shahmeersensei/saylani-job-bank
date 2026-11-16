import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DateTimePicker } from './DateTimePicker';

describe('DateTimePicker', () => {
  it('date mode shows DD/MM/YYYY for an ISO value', () => {
    render(<DateTimePicker mode="date" aria-label="Visit date" value="2026-10-01" />);
    expect(screen.getByLabelText('Visit date')).toHaveValue('01/10/2026');
  });

  it('date mode reports the ISO date for typed DD/MM/YYYY text', async () => {
    const onChange = vi.fn();
    render(<DateTimePicker mode="date" aria-label="Visit date" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Visit date'), '01102026');
    expect(onChange).toHaveBeenLastCalledWith('2026-10-01');
  });

  it('datetime mode combines date-then-time into one local value', async () => {
    const onChange = vi.fn();
    render(<DateTimePicker aria-label="Interview date" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Interview date'), '20112026');
    // Date alone is not a complete datetime yet.
    expect(onChange).toHaveBeenLastCalledWith('');
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '14:30' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-11-20T14:30');
  });

  it('datetime mode keeps the time when the date is picked after it', async () => {
    const onChange = vi.fn();
    render(<DateTimePicker aria-label="Interview date" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:15' } });
    expect(onChange).toHaveBeenLastCalledWith('');
    await userEvent.type(screen.getByLabelText('Interview date'), '20112026');
    expect(onChange).toHaveBeenLastCalledWith('2026-11-20T09:15');
  });

  it('datetime mode shows a prefilled value split across both fields', () => {
    render(
      <DateTimePicker aria-label="Interview date" value="2026-11-20T14:30" onChange={() => {}} />,
    );
    expect(screen.getByLabelText('Interview date')).toHaveValue('20/11/2026');
    expect(screen.getByLabelText('Time')).toHaveValue('14:30');
  });
});
