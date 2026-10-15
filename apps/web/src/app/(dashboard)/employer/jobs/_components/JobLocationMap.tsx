'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet's broken default icon paths in bundled environments
const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FlyTo({ lat, lng, enabled }: { lat: number; lng: number; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (enabled) map.flyTo([lat, lng], 13, { duration: 1 });
  }, [lat, lng, enabled, map]);
  return null;
}

interface Props {
  lat: number;
  lng: number;
  onPick: (lat: number, lng: number) => void;
}

const TILE_URL =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_MAP_TILE_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    : '';

const PAKISTAN_CENTER: [number, number] = [30.3753, 69.3451];

export default function JobLocationMap({ lat, lng, onPick }: Props) {
  const hasPin = lat !== 0 || lng !== 0;
  return (
    <MapContainer
      center={hasPin ? [lat, lng] : PAKISTAN_CENTER}
      zoom={hasPin ? 13 : 5}
      style={{ height: 280, width: '100%', borderRadius: 12, zIndex: 0 }}
      scrollWheelZoom
    >
      <TileLayer url={TILE_URL} attribution="© OpenStreetMap contributors" />
      <ClickHandler onPick={onPick} />
      <FlyTo lat={lat} lng={lng} enabled={hasPin} />
      {hasPin && <Marker position={[lat, lng]} icon={markerIcon} />}
    </MapContainer>
  );
}
