import { useCallback, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonSearchbar,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  IonIcon,
  IonBadge,
  IonSegment,
  IonSegmentButton,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { mapOutline, saveOutline } from 'ionicons/icons';
import { wsClient, newMutationId } from '../api/ws';
import { formatToman, formatKg, formatDate, normalizePhone } from '../utils/format';
import { LocationPicker } from '../components/LocationPicker';
import { DigitInput } from '../components/DigitInput';

interface CustomerRow {
  _id: string;
  name: string;
  phone?: string;
  address?: string;
  lat?: number;
  lng?: number;
  notes?: string;
  totalCredit?: number;
  monthKg?: number;
  monthAmount?: number;
  monthInvoices?: number;
  loyaltyTier?: 'gold' | 'silver' | 'bronze' | 'new';
  tierLabel?: string;
}

const Customers: React.FC = () => {
  const [list, setList] = useState<CustomerRow[]>([]);
  const [summary, setSummary] = useState({ gold: 0, silver: 0, bronze: 0, new: 0 });
  const [tab, setTab] = useState<'all' | 'gold' | 'silver' | 'bronze' | 'new'>('all');
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [editAddress, setEditAddress] = useState('');
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');
  const [invoices, setInvoices] = useState<
    Array<{ invoiceNumber: string; totalAmount: number; totalKg?: number; date: string; status?: string }>
  >([]);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const load = useCallback(async (q?: string) => {
    const data = await wsClient.request<{
      customers: CustomerRow[];
      summary: { gold: number; silver: number; bronze: number; new: number };
    }>('customer.directory', { search: q || undefined });
    setList(data.customers || []);
    setSummary(data.summary || { gold: 0, silver: 0, bronze: 0, new: 0 });
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  const create = async () => {
    if (!name.trim()) return;
    try {
      await wsClient.request(
        'customer.create',
        {
          name: name.trim(),
          phone: phone.trim() ? normalizePhone(phone) || undefined : undefined,
          address: address.trim() || undefined,
          lat: lat ?? undefined,
          lng: lng ?? undefined,
        },
        { clientMutationId: newMutationId(), queueIfOffline: true }
      );
      setName('');
      setPhone('');
      setAddress('');
      setLat(null);
      setLng(null);
      setToast({
        open: true,
        msg: lat != null ? 'مشتری با موقعیت نقشه ثبت شد' : 'مشتری ثبت شد',
        color: 'success',
      });
      await load(search);
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    }
  };

  const open = async (c: CustomerRow) => {
    setSelected(c);
    setEditAddress(c.address || '');
    setEditLat(c.lat != null ? String(c.lat) : '');
    setEditLng(c.lng != null ? String(c.lng) : '');
    try {
      const res = await wsClient.request<{
        invoices: Array<{
          invoiceNumber: string;
          totalAmount: number;
          totalKg?: number;
          date: string;
          status?: string;
        }>;
      }>('customer.get', { id: c._id });
      setInvoices(res.invoices || []);
    } catch {
      setInvoices([]);
    }
  };

  const saveAddress = async () => {
    if (!selected) return;
    try {
      const updated = await wsClient.request<CustomerRow>(
        'customer.update',
        {
          id: selected._id,
          address: editAddress.trim() || undefined,
          lat: editLat ? parseFloat(editLat) : undefined,
          lng: editLng ? parseFloat(editLng) : undefined,
        },
        { clientMutationId: newMutationId(), queueIfOffline: true }
      );
      setSelected({ ...selected, ...updated });
      setToast({ open: true, msg: 'آدرس ذخیره شد', color: 'success' });
      await load(search);
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    }
  };

  const openMap = (c: CustomerRow) => {
    if (c.lat != null && c.lng != null) {
      window.open(`https://maps.google.com/?q=${c.lat},${c.lng}`, '_blank');
      return;
    }
    window.open(`https://maps.google.com/?q=${encodeURIComponent(c.address || c.name)}`, '_blank');
  };

  const filtered = list.filter((c) => (tab === 'all' ? true : c.loyaltyTier === tab));

  const tierColor = (t?: string) =>
    t === 'gold' ? 'warning' : t === 'silver' ? 'medium' : t === 'bronze' ? 'tertiary' : 'primary';

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>مشتریان</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e: CustomEvent<RefresherEventDetail>) => {
            await load(search);
            e.detail.complete();
          }}
        >
          <IonRefresherContent />
        </IonRefresher>
        <div className="ion-padding compact">
          <div className="ios-kpi-grid">
            <div className="ios-kpi orange">
              <div className="k-label">طلایی</div>
              <div className="k-value">{summary.gold}</div>
            </div>
            <div className="ios-kpi gray">
              <div className="k-label">نقره‌ای ≥۲تن</div>
              <div className="k-value">{summary.silver}</div>
            </div>
            <div className="ios-kpi green">
              <div className="k-label">برنزی</div>
              <div className="k-value">{summary.bronze}</div>
            </div>
            <div className="ios-kpi blue">
              <div className="k-label">جدید</div>
              <div className="k-value">{summary.new}</div>
            </div>
          </div>

          <div className="ios-section-title">مشتری جدید</div>
          <div className="ios-glass-card">
            <IonItem lines="full">
              <IonLabel position="stacked">نام</IonLabel>
              <IonInput value={name} onIonInput={(e) => setName(e.detail.value || '')} />
            </IonItem>
            <DigitInput
              label="موبایل"
              mode="phone"
              value={phone}
              onChange={setPhone}
              placeholder="09…"
            />
            <IonItem lines="none">
              <IonLabel position="stacked">آدرس</IonLabel>
              <IonInput value={address} onIonInput={(e) => setAddress(e.detail.value || '')} />
            </IonItem>
            <p className="hint convert-hint" style={{ marginTop: 8 }}>
              موقعیت روی نقشه (اختیاری) — بزن روی نقشه یا موقعیت فعلی
            </p>
            <LocationPicker
              lat={lat}
              lng={lng}
              address={address}
              height={220}
              onChange={({ lat: la, lng: ln, address: street }) => {
                setLat(la);
                setLng(ln);
                if (street) setAddress(street);
              }}
            />
            {lat != null && lng != null && (
              <p className="hint">
                مختصات: {lat.toFixed(5)}, {lng.toFixed(5)}
              </p>
            )}
            <IonButton expand="block" className="ios-primary-btn ion-margin-top" onClick={() => void create()}>
              افزودن
            </IonButton>
          </div>

          <IonSearchbar
            value={search}
            placeholder="جستجو…"
            className="ios-search"
            onIonInput={(e) => {
              const v = e.detail.value || '';
              setSearch(v);
              void load(v);
            }}
          />

          <IonSegment
            value={tab}
            className="ios-segment"
            onIonChange={(e) => setTab((e.detail.value as typeof tab) || 'all')}
          >
            <IonSegmentButton value="all">
              <IonLabel>همه</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="silver">
              <IonLabel>نقره</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="gold">
              <IonLabel>طلا</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="bronze">
              <IonLabel>برنز</IonLabel>
            </IonSegmentButton>
          </IonSegment>

          {filtered.map((c) => (
            <div
              key={c._id}
              className={`ios-glass-card tap ${selected?._id === c._id ? 'selected-card' : ''}`}
              onClick={() => void open(c)}
              role="button"
              tabIndex={0}
            >
              <div className="ios-row">
                <div>
                  <strong>{c.name}</strong>
                  <div className="ios-caption">
                    {c.phone || '—'}
                    {c.address ? ` · ${c.address}` : ''}
                    {c.lat != null && c.lng != null ? ' · 📍 نقشه' : ''}
                  </div>
                  <div className="ios-caption">
                    این ماه: {formatKg(c.monthKg || 0)} · {formatToman(c.monthAmount || 0)}
                  </div>
                </div>
                <IonBadge color={tierColor(c.loyaltyTier)}>{c.tierLabel || 'جدید'}</IonBadge>
              </div>
            </div>
          ))}

          {selected && (
            <>
              <div className="ios-section-title">آدرس — {selected.name}</div>
              <div className="ios-glass-card">
                <IonItem lines="full">
                  <IonLabel position="stacked">آدرس</IonLabel>
                  <IonInput value={editAddress} onIonInput={(e) => setEditAddress(e.detail.value || '')} />
                </IonItem>
                <LocationPicker
                  lat={editLat ? parseFloat(editLat) : null}
                  lng={editLng ? parseFloat(editLng) : null}
                  address={editAddress}
                  onChange={({ lat, lng, address: street }) => {
                    setEditLat(String(lat));
                    setEditLng(String(lng));
                    if (street) setEditAddress(street);
                  }}
                />
                <div className="chip-row">
                  <IonButton size="small" onClick={() => void saveAddress()}>
                    <IonIcon slot="start" icon={saveOutline} />
                    ذخیره
                  </IonButton>
                  <IonButton size="small" fill="outline" onClick={() => openMap(selected)}>
                    <IonIcon slot="start" icon={mapOutline} />
                    نقشه
                  </IonButton>
                </div>
              </div>
              <div className="ios-section-title">فاکتورهای قبلی</div>
              <div className="ios-glass-card">
                {invoices.length === 0 && <p className="hint">فاکتوری نیست</p>}
                {invoices.map((inv) => (
                  <div key={inv.invoiceNumber} className="day-row">
                    {formatDate(inv.date)} · {inv.invoiceNumber} · {formatToman(inv.totalAmount)} ·{' '}
                    {formatKg(inv.totalKg || 0)}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2200}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default Customers;
