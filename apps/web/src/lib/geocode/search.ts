import 'server-only';
import { z } from 'zod';
import { env } from '@/lib/env';

/**
 * Forward geocoding: search text (area, landmark, street) -> coordinates + address + city code.
 *
 * Supports OpenCage (if OPENCAGE_API_KEY is configured), with fallback to Photon and Nominatim.
 * All requests are processed server-side with proper User-Agent headers, caching, and Pakistan bounding box.
 */

const USER_AGENT = 'JobBank/1.0 (https://jobbank.pk; geocode search)';
const REQUEST_TIMEOUT_MS = 6_000;

export const searchGeocodeQuery = z.object({
  q: z.string().trim().min(2, 'Search query must be at least 2 characters').max(200),
});

export interface GeocodeSearchResult {
  lat: number;
  lng: number;
  addressLine: string;
  cityCode: string | null;
  cityLabel: string | null;
  display: string;
}

// In-memory cache for search queries
const searchCache = new Map<string, GeocodeSearchResult[]>();

function matchCityCode(
  rawCity: string | null,
  cities: { code: string; label: string }[],
): { code: string; label: string } | null {
  if (!rawCity) return null;
  const wanted = rawCity.trim().toLowerCase();
  return (
    cities.find((c) => c.label.trim().toLowerCase() === wanted) ??
    cities.find((c) => c.label.trim().toLowerCase().includes(wanted)) ??
    null
  );
}

/** OpenCage Geocoder (if API key is present in environment) */
async function searchOpenCage(
  query: string,
  key: string,
  cities: { code: string; label: string }[],
): Promise<GeocodeSearchResult[]> {
  const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(
    query,
  )}&key=${key}&countrycode=pk&limit=5&no_annotations=1`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as {
    results?: Array<{
      geometry: { lat: number; lng: number };
      formatted: string;
      components?: {
        city?: string;
        town?: string;
        suburb?: string;
        neighbourhood?: string;
        road?: string;
        state?: string;
      };
    }>;
  };

  if (!data.results || data.results.length === 0) return [];

  return data.results.map((item) => {
    const comp = item.components ?? {};
    const rawCity = comp.city ?? comp.town ?? comp.suburb ?? null;
    const matched = matchCityCode(rawCity, cities);
    return {
      lat: Math.round(item.geometry.lat * 1e6) / 1e6,
      lng: Math.round(item.geometry.lng * 1e6) / 1e6,
      addressLine: [comp.road, comp.neighbourhood ?? comp.suburb, rawCity]
        .filter(Boolean)
        .join(', '),
      cityCode: matched?.code ?? null,
      cityLabel: matched?.label ?? rawCity,
      display: item.formatted,
    };
  });
}

/** Photon geocoder (fast, open-source OSM index) */
async function searchPhoton(
  query: string,
  cities: { code: string; label: string }[],
): Promise<GeocodeSearchResult[]> {
  // Pakistan bbox: minLng: 60.8, minLat: 23.5, maxLng: 77.9, maxLat: 37.2
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
    query,
  )}&bbox=60.8,23.5,77.9,37.2&limit=5`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as {
    features?: Array<{
      geometry: { coordinates: [number, number] }; // [lng, lat]
      properties?: {
        name?: string;
        street?: string;
        housenumber?: string;
        district?: string;
        city?: string;
        state?: string;
        country?: string;
      };
    }>;
  };

  if (!data.features || data.features.length === 0) return [];

  return data.features.map((item) => {
    const p = item.properties ?? {};
    const rawCity = p.city ?? p.district ?? null;
    const matched = matchCityCode(rawCity, cities);
    const lineParts = [p.name, p.street, p.district, rawCity].filter(Boolean);
    return {
      lat: Math.round(item.geometry.coordinates[1] * 1e6) / 1e6,
      lng: Math.round(item.geometry.coordinates[0] * 1e6) / 1e6,
      addressLine: lineParts.slice(0, 3).join(', '),
      cityCode: matched?.code ?? null,
      cityLabel: matched?.label ?? rawCity,
      display: [p.name, p.city, p.state].filter(Boolean).join(', '),
    };
  });
}

/** Nominatim OpenStreetMap fallback */
async function searchNominatim(
  query: string,
  cities: { code: string; label: string }[],
): Promise<GeocodeSearchResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
    query,
  )}&countrycodes=pk&limit=5&addressdetails=1`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
    address?: {
      road?: string;
      neighbourhood?: string;
      suburb?: string;
      city?: string;
      town?: string;
      state?: string;
    };
  }>;

  if (!Array.isArray(data) || data.length === 0) return [];

  return data.map((item) => {
    const a = item.address ?? {};
    const rawCity = a.city ?? a.town ?? a.suburb ?? null;
    const matched = matchCityCode(rawCity, cities);
    return {
      lat: Math.round(Number(item.lat) * 1e6) / 1e6,
      lng: Math.round(Number(item.lon) * 1e6) / 1e6,
      addressLine: [a.road, a.neighbourhood ?? a.suburb, rawCity].filter(Boolean).join(', '),
      cityCode: matched?.code ?? null,
      cityLabel: matched?.label ?? rawCity,
      display: item.display_name,
    };
  });
}

export async function searchGeocode(
  query: string,
  cities: { code: string; label: string }[] = [],
): Promise<GeocodeSearchResult[]> {
  const cleanQuery = query.trim().toLowerCase();
  const cacheKey = `${cleanQuery},${cities.length}`;
  const hit = searchCache.get(cacheKey);
  if (hit) return hit;

  let results: GeocodeSearchResult[] = [];

  // 1. Try OpenCage if API key is configured
  const openCageKey = env.OPENCAGE_API_KEY;
  if (openCageKey) {
    try {
      results = await searchOpenCage(query, openCageKey, cities);
    } catch {
      // Fall through to next provider
    }
  }

  // 2. Try Photon if OpenCage wasn't used or yielded no results
  if (results.length === 0) {
    try {
      results = await searchPhoton(query, cities);
    } catch {
      // Fall through to next provider
    }
  }

  // 3. Fallback to Nominatim
  if (results.length === 0) {
    try {
      results = await searchNominatim(query, cities);
    } catch {
      // Fall through to empty
    }
  }

  searchCache.set(cacheKey, results);
  return results;
}
