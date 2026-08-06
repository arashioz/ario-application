import { useCallback, useMemo, useState } from 'react';
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
  IonButtons,
  IonSearchbar,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  IonIcon,
  IonBadge,
  IonSegment,
  IonSegmentButton,
  IonModal,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { mapOutline, saveOutline, addOutline, eyeOutline, receiptOutline, personAddOutline } from 'ionicons/icons';
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

interface CustomerInvoiceItem {
  productName: string;
  qtyKg: number;
  totalPrice: number;
  unit?: 'kg' | 'package';
  qtyInput?: number;
  unitPrice?: number;
  unitPricePerKg?: number;
  discount?: number;
}

interface CustomerInvoice {
  _id?: string;
  invoiceNumber: string;
  totalAmount: number;
  totalKg?: number;
  totalProfit?: number;
  discount?: number;
  date: string;
  status?: string;
  paymentMethod?: string;
  payment?: { cash?: number; card?: number; credit?: number };
  priceTier?: string;
  isGolden?: boolean;
  notes?: string;
  items?: CustomerInvoiceItem[];
}

const STATUS: Record<string, string> = {
  pending: 'منتظر تأیید',
  approved: 'تأیید شده',
  shipped: 'ارسال شده',
  delivered: 'تحویل شد',
  cancelled: 'لغو',
  inactive: 'غیرفعال',
};

const PAY: Record<string, string> = {
  cash: 'نقد',
  card: 'پوز',
  card_to_card: 'کارت به کارت',
  credit: 'نسیه',
  mixed: 'ترکیبی',
};

const TIER: Record<string, string> = {
  retail: 'تکی',
  supermarket: 'سوپرمارکت',
  wholesale: 'عمده',
};

const Customers: React.FC = () => {
  const history = useHistory();
  const [list, setList] = useState<CustomerRow[]>([]);
  const [summary, setSummary] = useState({ gold: 0, silver: 0, bronze: 0, new: 0 });
  const [tab, setTab] = useState<'all' | 'gold' | 'silver' | 'bronze' | 'new'>('all');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editAddress, setEditAddress] = useState('');
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [invDetail, setInvDetail] = useState<CustomerInvoice | null>(null);
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
      setCreateOpen(false);
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
    setDetailOpen(true);
    setEditAddress(c.address || '');
    setEditLat(c.lat != null ? String(c.lat) : '');
    setEditLng(c.lng != null ? String(c.lng) : '');
    try {
      const res = await wsClient.request<{
        customer?: CustomerRow;
        invoices: CustomerInvoice[];
      }>('customer.get', { id: c._id });
      if (res.customer) setSelected({ ...c, ...res.customer });
      setInvoices(res.invoices || []);
    } catch {
      setInvoices([]);
    }
  };

  const stats = useMemo(() => {
    const active = invoices.filter((i) => i.status !== 'cancelled' && i.status !== 'inactive');
    const totalAmount = active.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const totalKg = active.reduce((s, i) => s + (i.totalKg || 0), 0);
    const totalCreditOpen = active.reduce((s, i) => s + (i.payment?.credit || 0), 0);
    const debt = selected?.totalCredit ?? totalCreditOpen;
    return {
      totalAmount,
      totalKg,
      invoiceCount: active.length,
      debt,
      monthAmount: selected?.monthAmount || 0,
      monthKg: selected?.monthKg || 0,
      monthInvoices: selected?.monthInvoices || 0,
    };
  }, [invoices, selected]);

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

  const goNewInvoice = (c: CustomerRow) => {
    history.push('/sale', { followUpCustomerId: c._id });
  };

  const filtered = list.filter((c) => (tab === 'all' ? true : c.loyaltyTier === tab));

  const tierColor = (t?: string) =>
    t === 'gold' ? 'warning' : t === 'silver' ? 'medium' : t === 'bronze' ? 'tertiary' : 'primary';

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>مشتریان</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setCreateOpen(true)}>
              <IonIcon slot="start" icon={personAddOutline} />
              جدید
            </IonButton>
          </IonButtons>
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

          <IonButton expand="block" className="ios-primary-btn" onClick={() => setCreateOpen(true)}>
            <IonIcon slot="start" icon={addOutline} />
            مشتری جدید
          </IonButton>

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
              className="ios-glass-card tap"
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
                  </div>
                  <div className="ios-caption">
                    این ماه: {formatKg(c.monthKg || 0)} · {formatToman(c.monthAmount || 0)}
                    {(c.totalCredit || 0) > 0 ? ` · بدهی ${formatToman(c.totalCredit || 0)}` : ''}
                  </div>
                </div>
                <IonBadge color={tierColor(c.loyaltyTier)}>{c.tierLabel || 'جدید'}</IonBadge>
              </div>
            </div>
          ))}
        </div>

        {/* ایجاد مشتری */}
        <IonModal isOpen={createOpen} onDidDismiss={() => setCreateOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>مشتری جدید</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setCreateOpen(false)}>بستن</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
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
              موقعیت روی نقشه (اختیاری)
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
            <IonButton
              expand="block"
              className="ios-primary-btn ion-margin-top"
              disabled={!name.trim()}
              onClick={() => void create()}
            >
              ثبت مشتری
            </IonButton>
          </IonContent>
        </IonModal>

        {/* جزئیات مشتری */}
        <IonModal
          isOpen={detailOpen && !!selected}
          onDidDismiss={() => {
            setDetailOpen(false);
            setSelected(null);
          }}
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>{selected?.name || 'مشتری'}</IonTitle>
              <IonButtons slot="end">
                <IonButton
                  onClick={() => {
                    setDetailOpen(false);
                    setSelected(null);
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
                <p className="hint">
                  {selected.phone || 'بدون تلفن'}
                  {selected.address ? ` · ${selected.address}` : ''}
                </p>

                <div className="ios-section-title" style={{ marginTop: 0 }}>
                  گزارش مشتری
                </div>
                <div className="ios-kpi-grid">
                  <div className="ios-kpi rose">
                    <div className="k-label">بدهکاری</div>
                    <div className="k-value">{formatToman(stats.debt)}</div>
                  </div>
                  <div className="ios-kpi orange">
                    <div className="k-label">فروش این ماه</div>
                    <div className="k-value">{formatToman(stats.monthAmount)}</div>
                  </div>
                  <div className="ios-kpi blue">
                    <div className="k-label">کل فروش</div>
                    <div className="k-value">{formatToman(stats.totalAmount)}</div>
                  </div>
                  <div className="ios-kpi green">
                    <div className="k-label">کل تناژ</div>
                    <div className="k-value">{formatKg(stats.totalKg)}</div>
                  </div>
                </div>
                <div className="ios-glass-card">
                  <div className="stat-row">
                    <span className="stat-label">تناژ این ماه</span>
                    <span className="stat-value">{formatKg(stats.monthKg)}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">فاکتور این ماه</span>
                    <span className="stat-value">{stats.monthInvoices}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">کل فاکتورها</span>
                    <span className="stat-value">{stats.invoiceCount}</span>
                  </div>
                </div>

                <div className="chip-row">
                  <IonButton size="small" color="success" onClick={() => goNewInvoice(selected)}>
                    <IonIcon slot="start" icon={addOutline} />
                    فاکتور جدید
                  </IonButton>
                  <IonButton size="small" fill="outline" onClick={() => openMap(selected)}>
                    <IonIcon slot="start" icon={mapOutline} />
                    نقشه
                  </IonButton>
                  <IonButton size="small" fill="outline" routerLink="/debtors">
                    نسیه
                  </IonButton>
                </div>

                <div className="ios-section-title">آدرس</div>
                <div className="ios-glass-card">
                  <IonItem lines="full">
                    <IonLabel position="stacked">آدرس</IonLabel>
                    <IonInput
                      value={editAddress}
                      onIonInput={(e) => setEditAddress(e.detail.value || '')}
                    />
                  </IonItem>
                  <LocationPicker
                    lat={editLat ? parseFloat(editLat) : null}
                    lng={editLng ? parseFloat(editLng) : null}
                    address={editAddress}
                    onChange={({ lat: la, lng: ln, address: street }) => {
                      setEditLat(String(la));
                      setEditLng(String(ln));
                      if (street) setEditAddress(street);
                    }}
                  />
                  <IonButton size="small" onClick={() => void saveAddress()}>
                    <IonIcon slot="start" icon={saveOutline} />
                    ذخیره آدرس
                  </IonButton>
                </div>

                <div className="ios-section-title">ریز سفارش‌ها / فاکتورها</div>
                {invoices.length === 0 && <p className="hint">فاکتوری نیست</p>}
                {invoices.map((inv) => (
                  <div key={inv.invoiceNumber} className="inv-card" style={{ marginBottom: 10 }}>
                    <div className="inv-card-top">
                      <div>
                        <div className="inv-card-num">
                          {inv.isGolden ? '⭐ ' : ''}
                          {inv.invoiceNumber}
                        </div>
                        <div className="inv-card-meta">
                          {formatDate(inv.date)}
                          {inv.priceTier ? ` · ${TIER[inv.priceTier] || inv.priceTier}` : ''}
                          {inv.paymentMethod ? ` · ${PAY[inv.paymentMethod] || inv.paymentMethod}` : ''}
                          {inv.status ? ` · ${STATUS[inv.status] || inv.status}` : ''}
                        </div>
                      </div>
                      <div className="inv-card-amount">
                        <div className="inv-card-money">{formatToman(inv.totalAmount)}</div>
                        <div className="inv-card-kg">{formatKg(inv.totalKg || 0)}</div>
                      </div>
                    </div>
                    {(inv.payment?.credit || 0) > 0 && (
                      <div className="ios-caption" style={{ color: 'var(--ion-color-danger)' }}>
                        نسیه این فاکتور: {formatToman(inv.payment?.credit || 0)}
                      </div>
                    )}
                    {(inv.items || []).map((it, i) => {
                      const perKg =
                        it.unitPricePerKg ||
                        (it.qtyKg > 0 ? Math.round(it.totalPrice / it.qtyKg) : 0);
                      return (
                        <div key={i} className="ios-caption" style={{ marginTop: 4 }}>
                          {it.productName} · {formatKg(it.qtyKg)}
                          {it.unit === 'package' && it.qtyInput ? ` · ${it.qtyInput} بسته` : ''}
                          {' · فی '}
                          {formatToman(perKg)}/کیلو · {formatToman(it.totalPrice)}
                        </div>
                      );
                    })}
                    <div className="inv-card-actions">
                      <IonButton size="small" fill="clear" onClick={() => setInvDetail(inv)}>
                        <IonIcon slot="start" icon={eyeOutline} />
                        جزئیات
                      </IonButton>
                      <IonButton size="small" fill="outline" onClick={() => goNewInvoice(selected)}>
                        <IonIcon slot="start" icon={receiptOutline} />
                        فاکتور دوباره
                      </IonButton>
                    </div>
                  </div>
                ))}
              </>
            )}
          </IonContent>
        </IonModal>

        <IonModal isOpen={!!invDetail} onDidDismiss={() => setInvDetail(null)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>جزئیات فاکتور</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setInvDetail(null)}>بستن</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {invDetail && (
              <>
                <p>
                  <b>شماره:</b> {invDetail.invoiceNumber}
                  {invDetail.isGolden ? ' ⭐' : ''}
                </p>
                <p>
                  <b>تاریخ:</b> {formatDate(invDetail.date)}
                </p>
                <p>
                  <b>مبلغ:</b> {formatToman(invDetail.totalAmount)}
                </p>
                <p>
                  <b>تناژ:</b> {formatKg(invDetail.totalKg || 0)}
                </p>
                <p>
                  <b>وضعیت:</b> {STATUS[invDetail.status || ''] || invDetail.status || '—'}
                </p>
                <p>
                  <b>پرداخت:</b> {PAY[invDetail.paymentMethod || ''] || invDetail.paymentMethod || '—'}
                </p>
                {invDetail.payment && (
                  <div className="ios-glass-card">
                    <div className="stat-row">
                      <span>نقد</span>
                      <span>{formatToman(invDetail.payment.cash || 0)}</span>
                    </div>
                    <div className="stat-row">
                      <span>پوز / کارت</span>
                      <span>{formatToman(invDetail.payment.card || 0)}</span>
                    </div>
                    <div className="stat-row">
                      <span>نسیه</span>
                      <span className="warning">{formatToman(invDetail.payment.credit || 0)}</span>
                    </div>
                  </div>
                )}
                {(invDetail.items || []).map((it, i) => {
                  const perKg =
                    it.unitPricePerKg ||
                    (it.qtyKg > 0 ? Math.round(it.totalPrice / it.qtyKg) : 0);
                  return (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div className="stat-row">
                        <span>
                          <strong>{it.productName}</strong>
                        </span>
                        <span>{formatToman(it.totalPrice)}</span>
                      </div>
                      <div className="ios-caption">
                        {formatKg(it.qtyKg)} · فی {formatToman(perKg)}/کیلو
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </IonContent>
        </IonModal>

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
