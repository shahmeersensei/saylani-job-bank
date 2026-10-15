'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Crosshair, LocateFixed, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Button } from '@/components/atoms/Button';
import { colorVar } from '@/design-system/tokens';
import { env } from '@/lib/env';
import { cn } from '@/lib/utils/cn';
import type { LatLng, MapPinPickerProps } from './mapPinPicker.types';

const KARACHI: LatLng = { lat: 24.8607, lng: 67.0011 };

/** ~11 cm precision — plenty for a home or job-site pin. */
export const roundCoord = (n: number) => Math.round(n * 1e6) / 1e6;

// A divIcon avoids Leaflet's default PNG marker, whose image paths break under bundlers.
const pinIcon = L.divIcon({
  className: '',
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  html: `<svg width="32" height="42" viewBox="0 0 32 42" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1z" fill="var(--primary)" stroke="white" stroke-width="2"/><circle cx="16" cy="15.5" r="5.5" fill="white"/></svg>`,
});

function ClickToPlace({ onPick }: { onPick: (value: LatLng) => void }) {
  useMapEvents({ click: (event) => onPick({ lat: event.latlng.lat, lng: event.latlng.lng }) });
  return null;
}

function FollowValue({ value }: { value: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (value) map.panTo([value.lat, value.lng]);
  }, [map, value]);
  return null;
}

async function fetchReverseGeocode(
  lat: number,
  lng: number,
): Promise<{ addressLine: string; city?: string }> {
  try {
    const res = await fetch(`/api/v1/geocode/reverse?lat=${lat}&lng=${lng}`);
    if (!res.ok) return { addressLine: '' };
    const json = (await res.json()) as { data?: { addressLine?: string; cityLabel?: string } };
    return {
      addressLine: json.data?.addressLine ?? '',
      city: json.data?.cityLabel ?? undefined,
    };
  } catch {
    return { addressLine: '' };
  }
}

export default function MapPinPickerClient({
  value,
  onChange,
  onLocate,
  defaultCenter = KARACHI,
  zoom = 13,
  rings = [],
  readOnly = false,
  height = '20rem',
  label = 'Location',
  className,
}: MapPinPickerProps) {
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const center = value ?? defaultCenter;

  const pick = (next: LatLng) =>
    onChange?.({ lat: roundCoord(next.lat), lng: roundCoord(next.lng) });

  const markerHandlers = useMemo(
    () => ({
      dragend: (event: L.DragEndEvent) => {
        const { lat, lng } = (event.target as L.Marker).getLatLng();
        onChange?.({ lat: roundCoord(lat), lng: roundCoord(lng) });
      },
    }),
    [onChange],
  );

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setGeoError('Location is not available on this device. Tap the map to place the pin.');
      return;
    }
    setLocating(true);
    setGeoError(null);

    const onSuccess = async (position: GeolocationPosition) => {
      const coords = {
        lat: roundCoord(position.coords.latitude),
        lng: roundCoord(position.coords.longitude),
      };
      pick(coords);
      if (onLocate) {
        try {
          const { addressLine, city } = await fetchReverseGeocode(coords.lat, coords.lng);
          onLocate(coords, addressLine, city);
        } catch {
          onLocate(coords, '');
        }
      }
      setLocating(false);
    };
    const onFail = (error: GeolocationPositionError) => {
      setLocating(false);
      setGeoError(
        error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Tap the map to place the pin instead.'
          : 'Could not get your location. Tap the map to place the pin instead.',
      );
    };

    // Low accuracy first (WiFi/IP — fast, works on desktops), then high accuracy fallback.
    navigator.geolocation.getCurrentPosition(onSuccess, onFail, {
      enableHighAccuracy: false,
      timeout: 8_000,
      maximumAge: 300_000,
    });
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/v1/geocode/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error();
      const json = (await res.json()) as {
        data?: Array<{
          lat: number;
          lng: number;
          addressLine: string;
          cityCode: string | null;
          cityLabel: string | null;
          display: string;
        }>;
      };
      const results = json.data ?? [];
      if (results.length > 0 && results[0]) {
        const item = results[0];
        const nextCoords = {
          lat: item.lat,
          lng: item.lng,
        };
        pick(nextCoords);
        if (onLocate) {
          onLocate(nextCoords, item.addressLine || query, item.cityLabel ?? undefined);
        }
      } else {
        setSearchError('Location not found in Pakistan. Try a nearby area, town or landmark.');
      }
    } catch {
      setSearchError('Could not search location. Tap the map to place your pin.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className={cn('grid gap-3', className)}>
      <div
        className="border-border relative isolate overflow-hidden rounded-xl border"
        style={{ height }}
        role="application"
        aria-label={`${label} map. ${readOnly ? '' : 'Click or tap to place the pin; drag the pin to adjust.'}`}
      >
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={zoom}
          scrollWheelZoom={!readOnly}
          dragging
          className="size-full"
          attributionControl
        >
          <TileLayer
            url={env.NEXT_PUBLIC_MAP_TILE_URL}
            attribution={env.NEXT_PUBLIC_MAP_ATTRIBUTION}
          />
          {!readOnly && <ClickToPlace onPick={pick} />}
          <FollowValue value={value} />
          {value && (
            <>
              {rings.map((ring) => (
                <Circle
                  key={ring.meters}
                  center={[value.lat, value.lng]}
                  radius={ring.meters}
                  pathOptions={{
                    color: colorVar(ring.tone),
                    weight: 2,
                    fillOpacity: 0.04,
                    dashArray: '6 6',
                  }}
                />
              ))}
              <Marker
                position={[value.lat, value.lng]}
                icon={pinIcon}
                draggable={!readOnly}
                keyboard
                title={label}
                alt={label}
                eventHandlers={markerHandlers}
              />
            </>
          )}
        </MapContainer>
        {!value && !readOnly && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-[1000] flex justify-center px-3">
            <p className="bg-surface/95 text-fg shadow-popover rounded-full px-3 py-1.5 text-xs font-medium">
              <Crosshair className="me-1 inline size-3.5" aria-hidden="true" />
              Tap the map to drop a pin
            </p>
          </div>
        )}
      </div>

      {rings.length > 0 && value && (
        <ul className="text-fg-muted flex flex-wrap gap-3 text-xs" aria-label="Radius legend">
          {rings.map((ring) => (
            <li key={ring.meters} className="flex items-center gap-1.5">
              <span
                className="inline-block size-3 rounded-full border-2 border-dashed"
                style={{ borderColor: colorVar(ring.tone) }}
                aria-hidden="true"
              />
              {ring.label}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="grid gap-2.5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              onClick={locate}
              loading={locating}
              leftIcon={<LocateFixed />}
              className="shrink-0"
            >
              Use my location
            </Button>

            <form onSubmit={handleSearch} className="flex flex-1 items-center gap-1.5">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search area or landmark to place pin..."
                className="border-border-strong bg-surface text-fg placeholder:text-fg-subtle focus:border-focus h-10 w-full rounded-lg border px-3 text-sm shadow-xs outline-none"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={searching || !searchQuery.trim()}
                loading={searching}
                leftIcon={<Search />}
                aria-label="Search location on map"
              >
                Search
              </Button>
            </form>
          </div>

          {value ? (
            <p className="text-fg-muted text-xs">
              Pin placed — tap anywhere on the map or drag the pin to fine-tune.
            </p>
          ) : (
            <p className="text-fg-muted text-xs">
              Tap the map, click &quot;Use my location&quot;, or search an area to drop your home
              pin.
            </p>
          )}

          {searchError && (
            <p role="alert" className="text-warning-soft-fg text-xs">
              {searchError}
            </p>
          )}
          {geoError && (
            <p role="alert" className="text-warning-soft-fg text-xs">
              {geoError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
