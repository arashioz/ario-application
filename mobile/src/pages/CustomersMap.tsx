import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonRefresher,
  IonRefresherContent,
  IonModal,
  IonButton,
  IonChip,
  IonBadge,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { wsClient } from '../api/ws';
import { addBaseTiles } from '../utils/mapTiles';
import { formatToman, formatKg, formatDate } from '../utils/format';

interface InvItem {
  productName: string;
  qtyKg: number;
  qtyInput: number;
  unit: string;
  unitPricePerKg: number;
  totalPrice: number;
}

interface InvRow {
  id: string;
  invoiceNumber: string;
  date: string;
  totalAmount: number;
  totalKg: number;
  totalProfit?: number;
  discount?: number;
  status: string;
  paymentMethod?: string;
  priceTier?: string;
  itemCount: number;
  items: InvItem[];
}

interface MarkerRow {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  lat: number;
  lng: number;
  totalCredit?: number;
  lastVisitAt?: string | null;
  lastInvoiceNumber?: string;
  daysSinceVisit?: number | null;
  visitStatus: 'hot' | 'ok' | 'due' | 'cold' | 'never';
  totalKg: number;
  totalAmount: number;
  invoiceCount: number;
  invoices: InvRow[];
}

const STATUS: Record<string, string> = {
  pending: 'منتظر تأیید',
  approved: 'تأیید شده',
  shipped: 'ارسال شد',
  cancelled: 'لغو',
};

const VISIT: Record<string, { label: string; color: string }> = {
  hot: { label: 'ویزیت اخیر', color: '#10b981' },
  ok: { label: 'وضعیت خوب', color: '#1e3a5f' },
  due: { label: 'موعد فالوآپ', color: '#f59e0b' },
  cold: { label: 'مدتی ندیده', color: '#ef4444' },
  never: { label: 'هنوز فروشی نیست', color: '#64748b' },
};

const TEHRAN: L.LatLngExpression = [35.6892, 51.389];

const CustomersMap: React.FC = () => {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [markers, setMarkers] = useState<MarkerRow[]>([]);
  const [selected, setSelected] = useState<MarkerRow | null>(null);
  const [openInv, setOpenInv] = useState<InvRow | null>(null);
  const [stats, setStats] = useState({ count: 0, withSales: 0 });

  const load = useCallback(async () => {
    const data = await wsClient.request<{ markers: MarkerRow[]; count: number; withSales: number }>(
      'customer.map',
      {}
    );
    setMarkers(data.markers || []);
    setStats({ count: data.count || 0, withSales: data.withSales || 0 });
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { center: TEHRAN, zoom: 11, zoomControl: true });
    addBaseTiles(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const t1 = setTimeout(() => map.invalidateSize(), 200);
    const t2 = setTimeout(() => map.invalidateSize(), 700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !layerRef.current) return;
    layerRef.current.clearLayers();
    const bounds: L.LatLngExpression[] = [];

    for (const m of markers) {
      const color = VISIT[m.visitStatus]?.color || '#64748b';
      const mk = L.circleMarker([m.lat, m.lng], {
        radius: 11,
        color: '#fff',
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95,
      });
      mk.bindTooltip(m.name, { direction: 'top', opacity: 0.95 });
      mk.on('click', () => {
        setSelected(m);
        setOpenInv(null);
        mapRef.current?.setView([m.lat, m.lng], Math.max(mapRef.current.getZoom(), 14), {
          animate: true,
        });
      });
      layerRef.current.addLayer(mk);
      bounds.push([m.lat, m.lng]);
    }

    if (bounds.length > 1) {
      mapRef.current.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [40, 40], maxZoom: 14 });
    } else if (bounds.length === 1) {
      mapRef.current.setView(bounds[0], 14);
    }
    setTimeout(() => mapRef.current?.invalidateSize(), 100);
  }, [markers]);

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>نقشه مشتریان</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content customers-map-page">
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e: CustomEvent<RefresherEventDetail>) => {
            await load();
            e.detail.complete();
          }}
        >
          <IonRefresherContent />
        </IonRefresher>

        <div className="cmap-wrap">
          <div ref={mapEl} className="cmap-canvas" />
          <div className="cmap-legend ios-glass-card">
            <div className="ios-row">
              <strong>{stats.count} مشتری روی نقشه</strong>
              <IonBadge color="primary">{stats.withSales} با فروش</IonBadge>
            </div>
            <div className="cmap-keys">
              {Object.entries(VISIT).map(([k, v]) => (
                <span key={k} className="cmap-key">
                  <i style={{ background: v.color }} />
                  {v.label}
                </span>
              ))}
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>
              روی پین بزن تا ویزیت و فاکتورها باز شود
            </p>
          </div>
        </div>

        <IonModal
          isOpen={!!selected}
          initialBreakpoint={0.55}
          breakpoints={[0, 0.4, 0.55, 0.9]}
          onDidDismiss={() => {
            setSelected(null);
            setOpenInv(null);
          }}
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>{selected?.name || 'مشتری'}</IonTitle>
              <IonButtons slot="end">
                <IonButton
                  onClick={() => {
                    setSelected(null);
                    setOpenInv(null);
                  }}
                >
                  بستن
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {selected && (
              <>
                <div className="ios-glass-card">
                  <div className="ios-row">
                    <strong>{selected.name}</strong>
                    <IonChip
                      style={{
                        background: VISIT[selected.visitStatus].color,
                        color: '#fff',
                      }}
                    >
                      {VISIT[selected.visitStatus].label}
                    </IonChip>
                  </div>
                  <p className="hint convert-hint">
                    {selected.phone || 'بدون موبایل'}
                    {selected.address ? ` · ${selected.address}` : ''}
                  </p>
                  <div className="stat-row">
                    <span className="stat-label">آخرین ویزیت / فروش</span>
                    <span className="stat-value">
                      {selected.lastVisitAt
                        ? `${formatDate(selected.lastVisitAt)}${
                            selected.daysSinceVisit != null ? ` · ${selected.daysSinceVisit} روز پیش` : ''
                          }`
                        : 'هنوز ویزیت/فروش نیست'}
                    </span>
                  </div>
                  {selected.lastInvoiceNumber && (
                    <div className="stat-row">
                      <span className="stat-label">آخرین فاکتور</span>
                      <span className="stat-value">{selected.lastInvoiceNumber}</span>
                    </div>
                  )}
                  <div className="stat-row">
                    <span className="stat-label">جمع فروش</span>
                    <span className="stat-value">{formatToman(selected.totalAmount)}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">جمع کیلو</span>
                    <span className="stat-value">{formatKg(selected.totalKg)}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">تعداد فاکتور</span>
                    <span className="stat-value">{selected.invoiceCount}</span>
                  </div>
                  {(selected.totalCredit || 0) > 0 && (
                    <div className="stat-row">
                      <span className="stat-label">بدهی</span>
                      <span className="stat-value danger">{formatToman(selected.totalCredit || 0)}</span>
                    </div>
                  )}
                </div>

                <div className="ios-section-title">فاکتورها</div>
                {selected.invoices.length === 0 && <p className="hint">فاکتوری نیست</p>}
                {selected.invoices.map((inv) => (
                  <div key={inv.id} className="ios-glass-card">
                    <div className="ios-row">
                      <div>
                        <strong>{inv.invoiceNumber}</strong>
                        <div className="ios-caption">
                          {formatDate(inv.date)} · {STATUS[inv.status] || inv.status}
                        </div>
                      </div>
                      <div style={{ textAlign: 'left' }}>
                        <div className="stat-value">{formatToman(inv.totalAmount)}</div>
                        <div className="ios-caption">{formatKg(inv.totalKg)}</div>
                      </div>
                    </div>
                    <IonButton size="small" expand="block" fill="outline" onClick={() => setOpenInv(inv)}>
                      جزئیات فاکتور · {inv.itemCount} قلم
                    </IonButton>
                  </div>
                ))}
              </>
            )}
          </IonContent>
        </IonModal>

        <IonModal isOpen={!!openInv} onDidDismiss={() => setOpenInv(null)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{openInv?.invoiceNumber}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setOpenInv(null)}>بستن</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {openInv && (
              <>
                <p>
                  <b>تاریخ:</b> {formatDate(openInv.date)}
                </p>
                <p>
                  <b>وضعیت:</b> {STATUS[openInv.status] || openInv.status}
                </p>
                <p>
                  <b>مبلغ:</b> {formatToman(openInv.totalAmount)}
                </p>
                <p>
                  <b>تناژ:</b> {formatKg(openInv.totalKg)}
                </p>
                {openInv.discount ? (
                  <p>
                    <b>تخفیف:</b> {formatToman(openInv.discount)}
                  </p>
                ) : null}
                <div className="ios-glass-card">
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    چه چیزهایی فروخته شد
                  </div>
                  {openInv.items.map((it, i) => (
                    <div key={i} className="day-row">
                      <div className="ios-row">
                        <strong>{it.productName}</strong>
                        <span>{formatToman(it.totalPrice)}</span>
                      </div>
                      <div className="ios-caption">
                        {formatKg(it.qtyKg)}
                        {it.unit === 'package'
                          ? ` · ${it.qtyInput.toLocaleString('fa-IR')} بسته`
                          : ` · ${it.qtyInput.toLocaleString('fa-IR')} کیلو`}
                        {' · '}
                        فی {formatToman(it.unitPricePerKg)}/کیلو
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default CustomersMap;
