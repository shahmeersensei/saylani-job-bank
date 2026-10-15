'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Crosshair, LocateFixed } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { Label } from '@/components/atoms/Label';
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

async function _reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'SaylaniJobBank/1.0' } },
    );
    if (!res.ok) return '';
    const json = (await res.json()) as {
      address?: {
        house_number?: string;
        road?: string;
        neighbourhood?: string;
        suburb?: string;
        town?: string;
        city?: string;
        village?: string;
        state?: string;
        country?: string;
      };
      display_name?: string;
    };
    const a = json.address ?? {};
    // Build a readable address line from the most useful parts
    const parts = [a.house_number, a.road, a.neighbourhood ?? a.suburb].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : (json.display_name ?? '');
  } catch {
    return '';
  }
}

export default function MapPinPickerClient({
  value,
  onChange,
  onLocate: _onLocate,
  defaultCenter = KARACHI,
  zoom = 13,
  rings = [],
  readOnly = false,
  height = '20rem',
  label = 'Location',
  className,
}: MapPinPickerProps) {
  const id = useId();
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
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

    const onSuccess = (position: GeolocationPosition) => {
      setLocating(false);
      pick({ lat: position.coords.latitude, lng: position.coords.longitude });
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

  const setCoordinate = (axis: keyof LatLng, raw: string) => {
    const parsed = Number(raw);
    const limit = axis === 'lat' ? 90 : 180;
    if (raw === '' || !Number.isFinite(parsed) || Math.abs(parsed) > limit) return;
    pick({ ...(value ?? defaultCenter), [axis]: parsed });
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
        <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
          <Button
            variant="secondary"
            onClick={locate}
            loading={locating}
            leftIcon={<LocateFixed />}
          >
            Use my location
          </Button>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-lat`}>Latitude</Label>
            <Input
              id={`${id}-lat`}
              type="number"
              inputMode="decimal"
              step="0.000001"
              min={-90}
              max={90}
              value={value?.lat ?? ''}
              onChange={(event) => setCoordinate('lat', event.target.value)}
              className="numeric"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-lng`}>Longitude</Label>
            <Input
              id={`${id}-lng`}
              type="number"
              inputMode="decimal"
              step="0.000001"
              min={-180}
              max={180}
              value={value?.lng ?? ''}
              onChange={(event) => setCoordinate('lng', event.target.value)}
              className="numeric"
            />
          </div>
        </div>
      )}
      {geoError && (
        <p role="alert" className="text-warning-soft-fg text-sm">
          {geoError}
        </p>
      )}
    </div>
  );
}
