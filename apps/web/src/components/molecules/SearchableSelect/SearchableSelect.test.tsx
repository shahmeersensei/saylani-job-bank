import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchableSelect } from './SearchableSelect';

const AREAS = [
  { value: 'GULSHAN', label: 'Gulshan-e-Iqbal' },
  { value: 'JAUHAR', label: 'Gulistan-e-Jauhar' },
  { value: 'NAZIMABAD', label: 'North Nazimabad' },
  { value: 'SADDAR', label: 'Saddar' },
];

describe('SearchableSelect', () => {
  it('shows the selected label and narrows the list as staff type', async () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect
        aria-label="Area"
        value="SADDAR"
        options={AREAS}
        onChange={onChange}
        placeholder="Choose an area"
      />,
    );
    const input = screen.getByLabelText('Area');
    expect(input).toHaveValue('Saddar');

    await userEvent.click(input);
    expect(screen.getByRole('option', { name: 'Gulshan-e-Iqbal' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Saddar' })).toBeInTheDocument();

    await userEvent.type(input, 'gul');
    expect(screen.getByRole('option', { name: 'Gulshan-e-Iqbal' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Saddar' })).not.toBeInTheDocument();
  });

  it('stores the option code when staff pick a match', async () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect
        aria-label="Area"
        value=""
        options={AREAS}
        onChange={onChange}
        placeholder="Choose an area"
      />,
    );
    const input = screen.getByLabelText('Area');
    await userEvent.click(input);
    await userEvent.type(input, 'jauhar');
    await userEvent.click(screen.getByRole('option', { name: 'Gulistan-e-Jauhar' }));
    expect(onChange).toHaveBeenCalledWith('JAUHAR');
  });

  it('picks the single match with Enter', async () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect
        aria-label="Area"
        value=""
        options={AREAS}
        onChange={onChange}
        placeholder="Choose an area"
      />,
    );
    const input = screen.getByLabelText('Area');
    await userEvent.click(input);
    await userEvent.type(input, 'nazimabad');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('NAZIMABAD');
  });

  it('shows a no-matches message for text that matches nothing', async () => {
    render(
      <SearchableSelect
        aria-label="Area"
        value=""
        options={AREAS}
        onChange={vi.fn()}
        placeholder="Choose an area"
      />,
    );
    const input = screen.getByLabelText('Area');
    await userEvent.click(input);
    await userEvent.type(input, 'zzz');
    expect(screen.getByText('No matches — try a different spelling.')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('clears the value when staff delete the text', async () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect
        aria-label="Area"
        value="SADDAR"
        options={AREAS}
        onChange={onChange}
        placeholder="Choose an area"
      />,
    );
    const input = screen.getByLabelText('Area');
    await userEvent.click(input);
    await userEvent.clear(input);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('reverts to the selected label when blurred with unmatched text', async () => {
    render(
      <SearchableSelect
        aria-label="Area"
        value="SADDAR"
        options={AREAS}
        onChange={vi.fn()}
        placeholder="Choose an area"
      />,
    );
    const input = screen.getByLabelText('Area');
    await userEvent.click(input);
    await userEvent.type(input, 'zzz');
    fireEvent.blur(input);
    // Blur closes on a 150 ms timer, like the geocode picker.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(input).toHaveValue('Saddar');
  });
});
