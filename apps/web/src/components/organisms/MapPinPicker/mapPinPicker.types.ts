import type { Tone } from '@/design-system/tokens';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RadiusRing {
  meters: number;
  tone: Extract<Tone, 'success' | 'warning' | 'danger' | 'info'>;
  label: string;
}

export interface MapPinPickerProps {
  value: LatLng | null;
  onChange?: (value: LatLng) => void;
  /**
   * Fired only when the user clicks "Use my location" and geolocation succeeds.
   * Includes a reverse-geocoded address string (best-effort; may be empty).
   */
  onLocate?: (value: LatLng, addressLine: string) => void;
  /** Where the map opens when there is no value yet (defaults to Karachi). */
  defaultCenter?: LatLng;
  zoom?: number;
  /** Rings around the pin, e.g. 8 km preferred / 10 km max matching radius. */
  rings?: RadiusRing[];
  /** Display-only map (no click/drag, no inputs). */
  readOnly?: boolean;
  /** CSS height of the map, e.g. "20rem". */
  height?: string;
  /** Accessible description of what the pin represents, e.g. "Your home location". */
  label?: string;
  className?: string;
}
