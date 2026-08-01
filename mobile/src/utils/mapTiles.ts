import L from 'leaflet';

const MAPIR_KEY = (import.meta as { env?: Record<string, string> }).env?.VITE_MAPIR_KEY || '';
const USE_MAPIR = (import.meta as { env?: Record<string, string> }).env?.VITE_USE_MAPIR === 'true';

/** تایل‌های بدون کلید — روی موبایل ایران معمولاً بهتر از OSM خام کار می‌کنند */
const FALLBACK_LAYERS: Array<{ url: string; opts: L.TileLayerOptions; name: string }> = [
  {
    name: 'Carto',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    opts: {
      attribution: '© OpenStreetMap © CARTO',
      maxZoom: 20,
      subdomains: 'abcd',
    },
  },
  {
    name: 'Esri',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    opts: {
      attribution: '© Esri',
      maxZoom: 19,
    },
  },
  {
    name: 'OSM',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    },
  },
];

const MapirTileLayer = L.TileLayer.extend({
  createTile(coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
    L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile));

    const url = (this as unknown as { getTileUrl: (c: L.Coords) => string }).getTileUrl(coords);
    fetch(url, { headers: { 'x-api-key': MAPIR_KEY } })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((blob) => {
        tile.src = URL.createObjectURL(blob);
      })
      .catch(() => done(new Error('tile'), tile));

    return tile;
  },
});

export function hasMapirKey(): boolean {
  return Boolean(MAPIR_KEY) && USE_MAPIR;
}

export function addBaseTiles(map: L.Map): L.TileLayer {
  if (hasMapirKey()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer = new (MapirTileLayer as any)('https://map.ir/shiveh/{z}/{x}/{y}.png', {
      attribution: '© Map.ir',
      maxZoom: 20,
      tileSize: 256,
    });
    layer.addTo(map);
    return layer as L.TileLayer;
  }

  const primary = FALLBACK_LAYERS[0];
  const layer = L.tileLayer(primary.url, primary.opts).addTo(map);

  // اگر تایل اول خطا داد، لایه بعدی را جایگزین کن
  let fallbackIdx = 1;
  layer.on('tileerror', () => {
    if (fallbackIdx >= FALLBACK_LAYERS.length) return;
    const next = FALLBACK_LAYERS[fallbackIdx++];
    map.removeLayer(layer);
    L.tileLayer(next.url, next.opts).addTo(map);
  });

  return layer;
}

export function tileProviderLabel(): string {
  if (hasMapirKey()) return 'Map.ir';
  return 'نقشه خیابان';
}

export { MAPIR_KEY };
