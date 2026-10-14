import 'server-only';
import { z } from 'zod';

/**
 * Reverse geocoding via OpenStreetMap Nominatim: map pin → address line + city
 * code, so employers do not type an address the platform can already infer.
 *
 * Nominatim usage policy: a descriptive User-Agent, one request at a time and
 * a generous cache — every pin the platform has ever seen resolves only once.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'JobBank/1.0 (https://jobbank.pk; employer job forms)';
/** ~110 m precision — two pins inside the same block share a cache entry. */
const COORD_DECIMALS = 3;
const REQUEST_TIMEOUT_MS = 6_000;

export interface ReverseGeocodeResult {
  /** Suggested address line: street/area/city, trimmed. */
  addressLine: string;
  /** Matched master-data CITY code, when the OSM place name is one we know. */
  cityCode: string | null;
  cityLabel: string | null;
  /** Raw Nominatim display name (first 3 parts) for the manual-edit hint. */
  display: string;
}

export const reverseGeocodeQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

interface NominatimAddress {
  house_number?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
}

// Module-level cache: the server process sees every employer; keys are
// quantised coordinates + the resolved result (including cityCode misses).
const cache = new Map<string, ReverseGeocodeResult>();

const quantise = (n: number) => n.toFixed(COORD_DECIMALS);

function buildAddressLine(address: NominatimAddress, city: string | null): string {
  const parts = [
    address.house_number,
    address.road,
    address.neighbourhood ?? address.suburb ?? address.quarter,
    city,
  ];
  const line = parts.filter(Boolean).join(', ');
  return line.slice(0, 300);
}

function pickCity(address: NominatimAddress): string | null {
  return address.city ?? address.town ?? address.village ?? null;
}

function matchCityCode(
  osmCity: string | null,
  cities: { code: string; label: string }[],
): { code: string; label: string } | null {
  if (!osmCity) return null;
  const wanted = osmCity.trim().toLowerCase();
  return (
    cities.find((c) => c.label.trim().toLowerCase() === wanted) ??
    cities.find((c) => c.label.trim().toLowerCase().includes(wanted)) ??
    null
  );
}

async function fetchNominatim(lat: number, lng: number): Promise<NominatimAddress | null> {
  const url = `${NOMINATIM_URL}?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { address?: NominatimAddress } | null;
  return data?.address ?? null;
}

/**
 * Resolve a pin to an address line + city code. Cities are matched against
 * active CITY master data (exact label, then contains). Failures degrade to
 * `{ addressLine: '', cityCode: null }` — the form stays fully usable by hand.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  cities: { code: string; label: string }[],
): Promise<ReverseGeocodeResult> {
  const key = `${quantise(lat)},${quantise(lng)},${cities.length}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const empty: ReverseGeocodeResult = {
    addressLine: '',
    cityCode: null,
    cityLabel: null,
    display: '',
  };
  let address: NominatimAddress | null = null;
  try {
    address = await fetchNominatim(lat, lng);
  } catch {
    // Offline / rate-limited / timeout: keep the empty result.
  }
  if (!address) {
    cache.set(key, empty);
    return empty;
  }

  const osmCity = pickCity(address);
  const matched = matchCityCode(osmCity, cities);
  const result: ReverseGeocodeResult = {
    addressLine: buildAddressLine(address, matched?.label ?? osmCity),
    cityCode: matched?.code ?? null,
    cityLabel: matched?.label ?? osmCity,
    display: [osmCity, address.state].filter(Boolean).join(', '),
  };
  cache.set(key, result);
  return result;
}
