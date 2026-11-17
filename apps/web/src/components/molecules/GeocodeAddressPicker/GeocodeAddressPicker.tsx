'use client';

import { CITY_CENTRES } from '@jobbank/shared';
import { useRef, useState } from 'react';
import { Button, Input } from '@/components/atoms';
import { apiFetch } from '@/lib/api/client';
import { FormField } from '../FormField';

export interface GeocodeResult {
  lat: number;
  lng: number;
  addressLine: string;
  cityCode: string | null;
  cityLabel: string | null;
  display: string;
}

export interface GeocodeAddressPickerProps {
  /** Current point, or null when nothing is picked yet. */
  value: { lat: number; lng: number } | null;
  onChange: (value: { lat: number; lng: number } | null) => void;
  /** Full picked place — callers fill their address / city fields from it. */
  onPick?: (result: GeocodeResult) => void;
  /** City already chosen in the form: enables the "use city centre" fallback when search finds nothing. */
  cityCode?: string | null;
  cityLabel?: string | null;
  label?: string;
  hint?: string;
  placeholder?: string;
  initialQuery?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  /** Field id for error focus (see FormErrorSummary / useFocusFieldErrors). */
  id?: string;
}

/**
 * Address search in place of hand-typed latitude / longitude (removed
 * 2026-11-14): type an area, street or landmark, pick a match, and the
 * point comes from the server geocoder (GET /api/v1/geocode/search,
 * Photon → Nominatim, no key). The point keeps the same GeoPoint shape as
 * the old typed fields, so matching logic is unchanged.
 *
 * When search finds nothing or is unreachable, the caller-supplied city
 * offers its centre as a fallback pin — same fallback the CompanyWizard
 * uses — so the form is never deadlocked by the geocoder.
 */
export function GeocodeAddressPicker({
  value,
  onChange,
  onPick,
  cityCode,
  cityLabel,
  label = 'Search for the address',
  hint,
  placeholder = 'Type an area, street or landmark…',
  initialQuery = '',
  required,
  disabled,
  error,
  id,
}: GeocodeAddressPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onSearchChange(next: string) {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (next.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSearchNote(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await apiFetch<GeocodeResult[]>(
          `/api/v1/geocode/search?q=${encodeURIComponent(next.trim())}`,
        );
        const results = data ?? [];
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
        setSearchNote(
          results.length === 0 ? 'No matching place found — try a nearby area or landmark.' : null,
        );
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
        setSearchNote('Address search is unavailable right now — try again in a moment.');
      } finally {
        setSearching(false);
      }
    }, 500);
  }

  function pick(result: GeocodeResult) {
    setQuery(result.display || result.addressLine);
    setSuggestions([]);
    setShowSuggestions(false);
    setSearchNote(null);
    onChange({ lat: result.lat, lng: result.lng });
    onPick?.(result);
  }

  function useCityCentre() {
    if (!cityCode) return;
    const centre = CITY_CENTRES[cityCode];
    if (!centre) return;
    setSearchNote(null);
    onChange({ lat: centre.lat, lng: centre.lng });
    onPick?.({
      lat: centre.lat,
      lng: centre.lng,
      addressLine: query.trim() || cityLabel || cityCode,
      cityCode,
      cityLabel: cityLabel ?? null,
      display: query.trim() || cityLabel || cityCode,
    });
  }

  const centre = cityCode ? CITY_CENTRES[cityCode] : undefined;
  const showCentreFallback = searchNote !== null && centre !== undefined;

  return (
    <div className="grid gap-2">
      <div className="relative">
        <FormField label={label} required={required} hint={hint} error={error} id={id}>
          <Input
            placeholder={placeholder}
            value={query}
            disabled={disabled}
            onChange={(e) => onSearchChange(e.target.value)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          />
        </FormField>
        {searching && <p className="text-fg-muted mt-1 text-xs">Searching…</p>}
        {!searching && searchNote && <p className="text-fg-muted mt-1 text-xs">{searchNote}</p>}
        {showSuggestions && (
          <ul className="border-border bg-surface absolute top-full z-10 mt-1 w-full overflow-hidden rounded-xl border shadow-lg">
            {suggestions.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="hover:bg-surface-muted w-full px-4 py-2.5 text-left text-sm"
                  onMouseDown={() => pick(r)}
                >
                  {r.display || r.addressLine}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {value && (
        <p className="text-fg-muted text-xs">
          Location set: {value.lat.toFixed(6)}, {value.lng.toFixed(6)}{' '}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setQuery('');
              onChange(null);
            }}
          >
            Clear
          </Button>
        </p>
      )}
      {showCentreFallback && (
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={useCityCentre}>
            Use {cityLabel ?? cityCode} centre instead
          </Button>
        </div>
      )}
    </div>
  );
}
