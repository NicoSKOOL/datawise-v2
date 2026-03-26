import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoGridPoint } from '@/types/local-seo';

function getColor(position: number | null): string {
  if (position == null) return '#6b7280';
  if (position <= 3) return '#22c55e';
  if (position <= 7) return '#eab308';
  if (position <= 10) return '#f97316';
  return '#ef4444';
}

function getLabel(position: number | null): string {
  return position != null ? String(position) : '—';
}

interface GeoGridMapProps {
  center: { lat: number; lng: number };
  points: GeoGridPoint[];
  businessName?: string | null;
}

export default function GeoGridMap({ center, points, businessName }: GeoGridMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    // Clean up previous map
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapRef.current, {
      center: [center.lat, center.lng],
      zoom: 13,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    // Business center marker
    const centerIcon = L.divIcon({
      className: 'geogrid-center-marker',
      html: `<div style="
        width: 28px; height: 28px; border-radius: 50%;
        background: #6366f1; border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex; align-items: center; justify-content: center;
      "><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    L.marker([center.lat, center.lng], { icon: centerIcon })
      .addTo(map)
      .bindPopup(`<strong>${businessName || 'Business Location'}</strong>`);

    // Grid point markers
    for (const point of points) {
      const color = getColor(point.position);
      const label = getLabel(point.position);

      const icon = L.divIcon({
        className: 'geogrid-point-marker',
        html: `<div style="
          width: 32px; height: 32px; border-radius: 50%;
          background: ${color}; border: 2px solid white;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
          display: flex; align-items: center; justify-content: center;
          color: white; font-weight: 700; font-size: 12px;
          font-family: system-ui, sans-serif;
        ">${label}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const tooltip = point.position != null
        ? `Position: #${point.position}<br>Results at this point: ${point.total_results}`
        : `Not found in results<br>Results at this point: ${point.total_results}`;

      L.marker([point.lat, point.lng], { icon })
        .addTo(map)
        .bindPopup(tooltip);
    }

    // Fit bounds to include all points
    if (points.length > 0) {
      const allLats = [center.lat, ...points.map(p => p.lat)];
      const allLngs = [center.lng, ...points.map(p => p.lng)];
      const bounds = L.latLngBounds(
        [Math.min(...allLats), Math.min(...allLngs)],
        [Math.max(...allLats), Math.max(...allLngs)]
      );
      map.fitBounds(bounds, { padding: [30, 30] });
    }

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [center, points, businessName]);

  return (
    <div className="relative">
      <div ref={mapRef} className="w-full h-[500px] rounded-lg border z-0 relative" />
      <div className="absolute bottom-3 right-3 z-[1000] bg-card/95 backdrop-blur-sm rounded-lg border px-3 py-2 shadow-md">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Position</div>
        <div className="flex flex-col gap-1">
          {[
            { color: '#22c55e', label: '1-3' },
            { color: '#eab308', label: '4-7' },
            { color: '#f97316', label: '8-10' },
            { color: '#ef4444', label: '11+' },
            { color: '#6b7280', label: 'Not found' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ background: color }} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
