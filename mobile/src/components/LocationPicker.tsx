import { useEffect, useRef, useState } from 'react';
import { IonButton, IonIcon, IonSpinner } from '@ionic/react';
import { locateOutline, mapOutline } from 'ionicons/icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { addBaseTiles, tileProviderLabel } from '../utils/mapTiles';
import { geoErrorMessage, getCurrentPositionAsync } from '../utils/geo';
import { reverseGeocode } from '../utils/geocode';

const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface Props {
  lat?: number | null;
  lng?: number | null;
  address?: string;
  onChange?: (pos: { lat: number; lng: number; address?: string }) => void;
  height?: number;
  readOnly?: boolean;
  extraMarkers?: Array<{ lat: number; lng: number; label?: string; color?: string }>;
}

const TEHRAN = { lat: 35.6892, lng: 51.389 };

export const LocationPicker: React.FC<Props> = ({
  lat,
  lng,
  address,
  onChange,
  height = 240,
  readOnly = false,
  extraMarkers = [],
}) => {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const extrasRef = useRef<L.LayerGroup | null>(null);
  const onChangeRef = useRef(onChange);
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [streetLabel, setStreetLabel] = useState(address || '');
  const [error, setError] = useState('');

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (address) setStreetLabel(address);
  }, [address]);

  const emitWithStreet = async (la: number, ln: number) => {
    setResolving(true);
    setError('');
    try {
      const geo = await reverseGeocode(la, ln);
      setStreetLabel(geo.display);
      onChangeRef.current?.({ lat: la, lng: ln, address: geo.display });
    } catch {
      setStreetLabel('');
      onChangeRef.current?.({ lat: la, lng: ln });
      setError('نقشه OK — آدرس خیابان پیدا نشد؛ دستی بنویس');
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;

    const startLat = lat ?? TEHRAN.lat;
    const startLng = lng ?? TEHRAN.lng;

    const map = L.map(mapEl.current, {
      center: [startLat, startLng],
      zoom: 15,
      zoomControl: true,
    });
    addBaseTiles(map);
    extrasRef.current = L.layerGroup().addTo(map);

    if (!readOnly) {
      const marker = L.marker([startLat, startLng], { icon: markerIcon, draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        void emitWithStreet(p.lat, p.lng);
      });
      map.on('click', (e: L.LeafletMouseEvent) => {
        marker.setLatLng(e.latlng);
        void emitWithStreet(e.latlng.lat, e.latlng.lng);
      });
      markerRef.current = marker;
    } else {
      markerRef.current = L.marker([startLat, startLng], { icon: markerIcon, draggable: false }).addTo(map);
    }

    mapRef.current = map;
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 500);
    const t3 = setTimeout(() => map.invalidateSize(), 900);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      extrasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;
    if (lat == null || lng == null) return;
    markerRef.current.setLatLng([lat, lng]);
    mapRef.current.setView([lat, lng], mapRef.current.getZoom());
  }, [lat, lng]);

  useEffect(() => {
    if (!extrasRef.current || !mapRef.current) return;
    extrasRef.current.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const m of extraMarkers) {
      const mk = L.circleMarker([m.lat, m.lng], {
        radius: 10,
        color: m.color || '#1e3a5f',
        fillColor: m.color || '#1e3a5f',
        fillOpacity: 0.9,
      }).bindPopup(m.label || 'موقعیت');
      extrasRef.current.addLayer(mk);
      bounds.push([m.lat, m.lng]);
    }
    if (bounds.length > 1) {
      mapRef.current.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [40, 40] });
    } else if (bounds.length === 1) {
      mapRef.current.setView(bounds[0] as L.LatLngExpression, 14);
    }
  }, [extraMarkers]);

  const useMyLocation = () => {
    setLocating(true);
    setError('');
    void getCurrentPositionAsync({ enableHighAccuracy: true, timeout: 12000 })
      .then(async (pos) => {
        const { latitude, longitude } = pos.coords;
        markerRef.current?.setLatLng([latitude, longitude]);
        mapRef.current?.setView([latitude, longitude], 17);
        await emitWithStreet(latitude, longitude);
      })
      .catch((err) => setError(geoErrorMessage(err)))
      .finally(() => setLocating(false));
  };

  const openExternal = () => {
    if (streetLabel) {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(streetLabel)}`, '_blank');
      return;
    }
    if (lat != null && lng != null) {
      window.open(`https://maps.google.com/?q=${lat},${lng}`, '_blank');
    }
  };

  return (
    <div className="map-picker">
      {!readOnly && (
        <div className="map-picker-actions">
          <IonButton size="small" fill="outline" onClick={useMyLocation} disabled={locating || resolving}>
            {locating || resolving ? (
              <IonSpinner name="crescent" />
            ) : (
              <IonIcon slot="start" icon={locateOutline} />
            )}
            موقعیت من → آدرس
          </IonButton>
          <IonButton size="small" fill="clear" onClick={openExternal}>
            <IonIcon slot="start" icon={mapOutline} />
            نقشه خارجی
          </IonButton>
        </div>
      )}
      <div ref={mapEl} className="map-picker-canvas" style={{ height }} />
      <p className="hint">{tileProviderLabel()} · روی نقشه بزن تا آدرس خیابان پر شود</p>
      {(streetLabel || resolving) && (
        <p className="hint convert-hint street-address">
          {resolving ? 'در حال خواندن آدرس خیابان…' : `📍 ${streetLabel}`}
        </p>
      )}
      {error && <p className="hint danger-text">{error}</p>}
    </div>
  );
};

export default LocationPicker;
