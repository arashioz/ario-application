import { useCallback, useEffect, useMemo, useState } from 'react';
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
  IonChip,
  IonAlert,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import {
  mapOutline,
  saveOutline,
  addOutline,
  eyeOutline,
  receiptOutline,
  personAddOutline,
  createOutline,
  trashOutline,
  copyOutline,
} from 'ionicons/icons';
import { wsClient, newMutationId } from '../api/ws';
import {
  formatToman,
  formatKg,
  formatDate,
  normalizePhone,
  parseAmount,
} from '../utils/format';
import { AddressMapField } from '../components/AddressMapField';
import { DigitInput } from '../components/DigitInput';
import { MoneyInput } from '../components/MoneyInput';
import { InvoiceListPanel, SaleInvRow } from '../components/InvoiceListPanel';
import { SaleInvoiceDetailBody, summarizeSaleItems } from '../components/SaleInvoiceDetailBody';
import { buildInvoiceShareText, copyText } from '../utils/invoiceShare';
import { useAuth } from '../auth/AuthContext';

interface CustomerRow {
  _id: string;
  name: string;
  phone?: string;
  address?: string;
  lat?: number;
  lng?: number;
  notes?: string;
  totalCredit?: number;
  openCredit?: number;
  overdueCredit?: number;
  riskScore?: number;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  riskLabel?: string;
  monthKg?: number;
  monthAmount?: number;
  monthCollected?: number;
  monthInvoices?: number;
  loyaltyTier?: 'gold' | 'silver' | 'bronze' | 'new';
  tierLabel?: string;
}

interface CreditPayRow {
  id: string;
  debtorId: string;
  invoiceNumber?: string;
  amount: number;
  method: string;
  date: string;
  note?: string;
  debtAmount: number;
  debtPaid: number;
  settled: boolean;
}

interface CustomerInvoiceItem {
  productId?: string;
  productName: string;
  qtyKg: number;
  totalPrice: number;
  unit?: 'kg' | 'package';
  qtyInput?: number;
  unitPrice?: number;
  unitPricePerKg?: number;
  discount?: number;
  kgPerPackage?: number;
}

interface CustomerInvoice {
  _id?: string;
  invoiceNumber: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
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
  shippingNotes?: string;
  shippedAt?: string;
  paidAt?: string;
  lastPaymentAt?: string;
  isPaid?: boolean;
  items?: CustomerInvoiceItem[];
}

interface DebtRow {
  _id: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  dueDate: string;
  description?: string;
  customerId?: string;
  saleInvoiceId?: string;
  invoiceNumber?: string;
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

function invoicePayLabel(inv: {
  paymentMethod?: string;
  payment?: { cash?: number; card?: number; credit?: number };
  isPaid?: boolean;
}): string {
  const credit = Math.round(inv.payment?.credit || 0);
  const cash = Math.round(inv.payment?.cash || 0);
  const card = Math.round(inv.payment?.card || 0);
  if (credit > 0) {
    if (cash > 0 || card > 0) return `ترکیبی · نسیه ${formatToman(credit)}`;
    return `نسیه ${formatToman(credit)}`;
  }
  if (inv.isPaid || cash > 0 || card > 0) {
    if (cash > 0 && card > 0) return 'ترکیبی (تسویه)';
    if (cash > 0) return 'نقد (تسویه)';
    if (card > 0) return 'کارت/پوز (تسویه)';
    return PAY[inv.paymentMethod || ''] || 'تسویه‌شده';
  }
  return PAY[inv.paymentMethod || ''] || '—';
}

function toSaleInvRow(inv: CustomerInvoice, customer?: CustomerRow | null): SaleInvRow {
  return {
    _id: String(inv._id || ''),
    invoiceNumber: inv.invoiceNumber,
    customerName: inv.customerName || customer?.name,
    customerPhone: inv.customerPhone || customer?.phone,
    customerAddress: inv.customerAddress || customer?.address,
    totalAmount: inv.totalAmount,
    totalKg: inv.totalKg,
    totalProfit: inv.totalProfit,
    discount: inv.discount,
    status: inv.status,
    isGolden: inv.isGolden,
    paymentMethod: inv.paymentMethod,
    payment: inv.payment,
    priceTier: inv.priceTier,
    date: inv.date,
    notes: inv.notes,
    shippingNotes: inv.shippingNotes,
    shippedAt: inv.shippedAt,
    paidAt: inv.paidAt,
    lastPaymentAt: inv.lastPaymentAt,
    isPaid: inv.isPaid,
    items: (inv.items || []).map((it) => ({
      productId: it.productId ? String(it.productId) : undefined,
      productName: it.productName,
      qtyKg: it.qtyKg,
      totalPrice: it.totalPrice,
      unit: it.unit,
      qtyInput: it.qtyInput,
      unitPrice: it.unitPrice,
      unitPricePerKg: it.unitPricePerKg,
      discount: it.discount,
      kgPerPackage: it.kgPerPackage,
    })),
  };
}

const Customers: React.FC = () => {
  const history = useHistory();
  const { isAdmin } = useAuth();
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
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editLat, setEditLat] = useState<number | null>(null);
  const [editLng, setEditLng] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [creditPayments, setCreditPayments] = useState<CreditPayRow[]>([]);
  const [creditTab, setCreditTab] = useState<'open' | 'history' | 'invoices'>('open');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [invDetail, setInvDetail] = useState<CustomerInvoice | null>(null);
  const [seedEdit, setSeedEdit] = useState<SaleInvRow | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'card' | 'card_to_card'>('cash');
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const load = useCallback(async (q?: string) => {
    const data = await wsClient.request<{
      customers: CustomerRow[];
      summary: { gold: number; silver: number; bronze: number; new: number };
    }>('customer.directory', { search: q || undefined });
    setList(data.customers || []);
    setSummary(data.summary || { gold: 0, silver: 0, bronze: 0, new: 0 });
  }, []);

  const reloadSelected = useCallback(async (id: string, base?: CustomerRow | null) => {
    const [res, allDebts] = await Promise.all([
      wsClient.request<{
        customer?: CustomerRow;
        invoices: CustomerInvoice[];
        creditPayments?: CreditPayRow[];
      }>('customer.get', { id }),
      wsClient.request<DebtRow[]>('debtor.list', { settled: false }).catch(() => [] as DebtRow[]),
    ]);
    if (res.customer) setSelected({ ...(base || {}), ...res.customer });
    setInvoices(res.invoices || []);
    setCreditPayments(res.creditPayments || []);
    const cid = String(id);
    setDebts(
      (Array.isArray(allDebts) ? allDebts : []).filter((d) => String(d.customerId || '') === cid)
    );
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  useEffect(() => {
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === 'sale' || p?.entity === 'debtor' || p?.entity === 'customer') {
        void load(search).catch(console.warn);
        if (selected?._id) void reloadSelected(selected._id, selected).catch(console.warn);
      }
    });
    return unsub;
  }, [load, reloadSelected, search, selected]);
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
    setInvDetail(null);
    setSeedEdit(null);
    setPayAmount('');
    setCreditTab('open');
    try {
      await reloadSelected(c._id, c);
    } catch {
      setInvoices([]);
      setDebts([]);
      setCreditPayments([]);
    }
  };

  const openEditCustomer = () => {
    if (!selected) return;
    setEditName(selected.name || '');
    setEditPhone(selected.phone || '');
    setEditAddress(selected.address || '');
    setEditLat(selected.lat ?? null);
    setEditLng(selected.lng ?? null);
    setEditNotes(selected.notes || '');
    setEditOpen(true);
  };

  const saveCustomerEdit = async () => {
    if (!selected) return;
    if (!editName.trim()) {
      setToast({ open: true, msg: 'نام مشتری الزامی است', color: 'danger' });
      return;
    }
    setSavingEdit(true);
    try {
      const updated = await wsClient.request<CustomerRow>(
        'customer.update',
        {
          id: selected._id,
          name: editName.trim(),
          phone: editPhone.trim() ? normalizePhone(editPhone) || '' : '',
          address: editAddress.trim() || '',
          lat: editLat ?? undefined,
          lng: editLng ?? undefined,
          notes: editNotes.trim() || '',
        },
        { clientMutationId: newMutationId(), queueIfOffline: true }
      );
      setSelected({ ...selected, ...updated });
      setEditOpen(false);
      setToast({ open: true, msg: 'اطلاعات مشتری ذخیره شد', color: 'success' });
      await load(search);
      await reloadSelected(selected._id, { ...selected, ...updated });
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    } finally {
      setSavingEdit(false);
    }
  };

  const stats = useMemo(() => {
    const active = invoices.filter((i) => i.status !== 'cancelled' && i.status !== 'inactive');
    const totalAmount = active.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const totalKg = active.reduce((s, i) => s + (i.totalKg || 0), 0);
    const totalCreditOpen = active.reduce((s, i) => s + (i.payment?.credit || 0), 0);
    const debtRemaining = debts.reduce((s, d) => s + (d.remaining || 0), 0);
    const debt = selected?.totalCredit ?? (debtRemaining || totalCreditOpen);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthInvs = active.filter((i) => new Date(i.date) >= monthStart);
    const monthAmount =
      monthInvs.reduce((s, i) => s + (i.totalAmount || 0), 0) || selected?.monthAmount || 0;
    const monthCollected =
      monthInvs.reduce((s, i) => {
        const cash = Math.round(i.payment?.cash || 0);
        const card = Math.round(i.payment?.card || 0);
        let rec = cash + card;
        const credit = Math.round(i.payment?.credit || 0);
        const total = Math.round(i.totalAmount || 0);
        if (rec <= 0 && credit <= 0) rec = total;
        return s + rec;
      }, 0) || selected?.monthCollected || 0;
    const monthKg =
      monthInvs.reduce((s, i) => s + (i.totalKg || 0), 0) || selected?.monthKg || 0;

    return {
      totalAmount,
      totalKg,
      invoiceCount: active.length,
      debt,
      debtRemaining,
      monthAmount,
      monthCollected,
      monthKg,
      monthInvoices: monthInvs.length || selected?.monthInvoices || 0,
    };
  }, [invoices, selected, debts]);

  const creditInvoices = useMemo(
    () =>
      invoices.filter(
        (i) =>
          i.status !== 'cancelled' &&
          i.status !== 'inactive' &&
          (i.payment?.credit || 0) > 0
      ),
    [invoices]
  );

  const copyInvoiceReport = async (inv: CustomerInvoice) => {
    const text = buildInvoiceShareText({
      invoiceNumber: inv.invoiceNumber,
      customerName: inv.customerName || selected?.name,
      customerPhone: inv.customerPhone || selected?.phone,
      date: inv.date,
      totalAmount: inv.totalAmount,
      totalKg: inv.totalKg,
      discount: inv.discount,
      paymentMethod: inv.paymentMethod,
      isGolden: inv.isGolden,
      items: inv.items,
      payment: inv.payment,
      isPaid: inv.isPaid || (inv.payment?.credit || 0) <= 0,
    });
    const ok = await copyText(text);
    setToast({
      open: true,
      msg: ok ? 'گزارش فاکتور کپی شد (مبلغ / پرداخت‌شده / مانده نسیه)' : 'کپی نشد',
      color: ok ? 'success' : 'danger',
    });
  };

  const deleteCustomerNow = async () => {
    if (!selected) return;
    try {
      await wsClient.request(
        'customer.delete',
        { id: selected._id },
        { clientMutationId: newMutationId(), queueIfOffline: true }
      );
      setDetailOpen(false);
      setSelected(null);
      setDeleteConfirm(false);
      setToast({ open: true, msg: 'مشتری حذف شد', color: 'success' });
      await load(search);
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'حذف نشد',
        color: 'danger',
      });
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

  const startInvoiceEdit = (inv: CustomerInvoice) => {
    if (!inv._id) {
      setToast({ open: true, msg: 'شناسه فاکتور پیدا نشد', color: 'warning' });
      return;
    }
    setInvDetail(null);
    setSeedEdit(toSaleInvRow(inv, selected));
  };

  const onInvoiceEditDone = async () => {
    setSeedEdit(null);
    if (selected) {
      try {
        await reloadSelected(selected._id, selected);
        await load(search);
      } catch {
        /* ignore */
      }
    }
  };

  const payCustomerDebt = async () => {
    if (!selected) return;
    const amount = parseAmount(payAmount);
    if (!amount) {
      setToast({ open: true, msg: 'مبلغ را وارد کنید', color: 'danger' });
      return;
    }
    try {
      const res = await wsClient.request<{ applied: number }>(
        'debtor.payCustomer',
        {
          customerId: selected._id,
          amount,
          method: payMethod,
        },
        { clientMutationId: newMutationId(), queueIfOffline: true }
      );
      setPayAmount('');
      setToast({
        open: true,
        msg: `${formatToman(res.applied)} از نسیه کم شد`,
        color: 'success',
      });
      await reloadSelected(selected._id, selected);
      await load(search);
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    }
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
                    {(c.totalCredit || c.openCredit || 0) > 0
                      ? ` · بدهی ${formatToman(c.openCredit || c.totalCredit || 0)}`
                      : ''}
                  </div>
                  {c.riskLabel && (
                    <div
                      className="ios-caption"
                      style={{
                        color:
                          c.riskLevel === 'critical' || c.riskLevel === 'high'
                            ? 'var(--ion-color-danger)'
                            : c.riskLevel === 'medium'
                              ? 'var(--ion-color-warning)'
                              : undefined,
                      }}
                    >
                      {c.riskLabel}
                      {(c.overdueCredit || 0) > 0
                        ? ` · معوقه ${formatToman(c.overdueCredit || 0)}`
                        : ''}
                    </div>
                  )}
                </div>
                <IonBadge color={tierColor(c.loyaltyTier)}>{c.tierLabel || 'جدید'}</IonBadge>
              </div>
            </div>
          ))}
        </div>

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
            <AddressMapField
              label="آدرس"
              address={address}
              onAddressChange={setAddress}
              lat={lat}
              lng={lng}
              onLocationChange={({ lat: la, lng: ln, address: street }) => {
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

        <IonModal
          isOpen={detailOpen && !!selected}
          onDidDismiss={() => {
            setDetailOpen(false);
            setSelected(null);
            setSeedEdit(null);
            setInvDetail(null);
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

                <div className="chip-row">
                  <IonButton size="small" color="warning" onClick={openEditCustomer}>
                    <IonIcon slot="start" icon={createOutline} />
                    ویرایش
                  </IonButton>
                  <IonButton size="small" color="success" onClick={() => goNewInvoice(selected)}>
                    <IonIcon slot="start" icon={addOutline} />
                    فاکتور جدید
                  </IonButton>
                  <IonButton size="small" fill="outline" onClick={() => openMap(selected)}>
                    <IonIcon slot="start" icon={mapOutline} />
                    نقشه
                  </IonButton>
                  {isAdmin && (
                    <IonButton
                      size="small"
                      color="danger"
                      fill="outline"
                      onClick={() => setDeleteConfirm(true)}
                    >
                      <IonIcon slot="start" icon={trashOutline} />
                      حذف
                    </IonButton>
                  )}
                </div>

                <div className="ios-section-title" style={{ marginTop: 16 }}>
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
                    <span className="stat-label">وصول‌شده این ماه</span>
                    <span className="stat-value">{formatToman(stats.monthCollected)}</span>
                  </div>
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

                <div className="ios-section-title">نسیه‌ها</div>
                <IonSegment
                  value={creditTab}
                  className="ios-segment"
                  onIonChange={(e) =>
                    setCreditTab((e.detail.value as typeof creditTab) || 'open')
                  }
                >
                  <IonSegmentButton value="open">
                    <IonLabel>باز</IonLabel>
                  </IonSegmentButton>
                  <IonSegmentButton value="history">
                    <IonLabel>پرداخت‌ها</IonLabel>
                  </IonSegmentButton>
                  <IonSegmentButton value="invoices">
                    <IonLabel>فاکتور نسیه</IonLabel>
                  </IonSegmentButton>
                </IonSegment>
                {creditTab === 'history' && (
                  <div className="ios-glass-card" style={{ marginTop: 10 }}>
                    {creditPayments.length === 0 ? (
                      <p className="hint" style={{ margin: 0 }}>
                        هنوز پرداختی ثبت نشده (از این به بعد ریز تاریخ می‌ماند)
                      </p>
                    ) : (
                      creditPayments.map((p) => (
                        <div key={p.id} className="stat-row" style={{ alignItems: 'flex-start' }}>
                          <span className="stat-label">
                            {formatDate(p.date)}
                            {p.invoiceNumber ? ` · ${p.invoiceNumber}` : ''}
                            <br />
                            <span className="ios-caption">
                              {p.method === 'cash'
                                ? 'نقد'
                                : p.method === 'card_to_card'
                                  ? 'کارت‌به‌کارت'
                                  : 'پوز'}
                              {p.note ? ` · ${p.note}` : ''}
                              {p.settled ? ' · تسویه کامل' : ''}
                            </span>
                          </span>
                          <span className="stat-value success">{formatToman(p.amount)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {creditTab === 'invoices' && (
                  <div style={{ marginTop: 10 }}>
                    {creditInvoices.length === 0 ? (
                      <p className="hint">فاکتور نسیه باز نیست</p>
                    ) : (
                      creditInvoices.map((inv) => (
                        <div key={inv.invoiceNumber} className="inv-card" style={{ marginBottom: 8 }}>
                          <div className="inv-card-top">
                            <div>
                              <div className="inv-card-num">{inv.invoiceNumber}</div>
                              <div className="inv-card-meta">
                                {formatDate(inv.date)} · {invoicePayLabel(inv)}
                              </div>
                            </div>
                            <div className="inv-card-amount">
                              <div className="inv-card-money">{formatToman(inv.totalAmount)}</div>
                            </div>
                          </div>
                          <div className="ios-caption" style={{ color: 'var(--ion-color-danger)' }}>
                            مانده نسیه: {formatToman(inv.payment?.credit || 0)} · پرداخت‌شده:{' '}
                            {formatToman(
                              Math.round(inv.payment?.cash || 0) + Math.round(inv.payment?.card || 0)
                            )}
                          </div>
                          <IonButton
                            size="small"
                            fill="clear"
                            onClick={() => void copyInvoiceReport(inv)}
                          >
                            <IonIcon slot="start" icon={copyOutline} />
                            کپی گزارش
                          </IonButton>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {creditTab === 'open' &&
                  (stats.debt <= 0 && debts.length === 0 && creditInvoices.length === 0 ? (
                  <p className="hint">نسیه باز ندارد</p>
                ) : (
                  <div className="ios-glass-card" style={{ marginTop: 10 }}>
                    <div className="stat-row">
                      <span className="stat-label">مانده نسیه</span>
                      <span className="stat-value warning">
                        {formatToman(stats.debtRemaining || stats.debt)}
                      </span>
                    </div>
                    {debts.map((d) => (
                      <div key={d._id} className="ios-caption" style={{ marginTop: 6 }}>
                        {d.invoiceNumber || 'بدهی'} · سررسید {formatDate(d.dueDate)} · مانده{' '}
                        {formatToman(d.remaining)}
                        {d.saleInvoiceId ? (
                          <>
                            {' · '}
                            <button
                              type="button"
                              className="linkish"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--ion-color-primary)',
                                padding: 0,
                                font: 'inherit',
                              }}
                              onClick={() => {
                                const inv = invoices.find(
                                  (i) => String(i._id) === String(d.saleInvoiceId)
                                );
                                if (inv) startInvoiceEdit(inv);
                                else
                                  setToast({
                                    open: true,
                                    msg: 'فاکتور در لیست اخیر نیست — از ویرایش فاکتورها استفاده کنید',
                                    color: 'warning',
                                  });
                              }}
                            >
                              ویرایش مبلغ
                            </button>
                            {' · '}
                            <button
                              type="button"
                              className="linkish"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--ion-color-primary)',
                                padding: 0,
                                font: 'inherit',
                              }}
                              onClick={() => {
                                const inv = invoices.find(
                                  (i) => String(i._id) === String(d.saleInvoiceId)
                                );
                                if (inv) void copyInvoiceReport(inv);
                              }}
                            >
                              کپی گزارش
                            </button>
                          </>
                        ) : null}
                      </div>
                    ))}
                    {isAdmin && (stats.debtRemaining > 0 || stats.debt > 0) && (
                      <>
                        <div className="chip-row" style={{ marginTop: 10 }}>
                          <IonChip
                            className={payMethod === 'cash' ? 'ios-chip-active' : 'ios-chip'}
                            onClick={() => setPayMethod('cash')}
                          >
                            نقد
                          </IonChip>
                          <IonChip
                            className={payMethod === 'card' ? 'ios-chip-active' : 'ios-chip'}
                            onClick={() => setPayMethod('card')}
                          >
                            پوز
                          </IonChip>
                          <IonChip
                            className={payMethod === 'card_to_card' ? 'ios-chip-active' : 'ios-chip'}
                            onClick={() => setPayMethod('card_to_card')}
                          >
                            کارت به کارت
                          </IonChip>
                        </div>
                        <MoneyInput
                          label="دریافت از نسیه (تومان)"
                          value={payAmount}
                          onChange={(v) => setPayAmount(v)}
                        />
                        <IonButton
                          expand="block"
                          size="small"
                          className="ion-margin-top"
                          disabled={!payAmount}
                          onClick={() => void payCustomerDebt()}
                        >
                          ثبت دریافت نسیه
                        </IonButton>
                      </>
                    )}
                  </div>
                ))}

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
                          {` · ${invoicePayLabel(inv)}`}
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
                        نسیه این فاکتور: {formatToman(inv.payment?.credit || 0)} · پرداخت‌شده:{' '}
                        {formatToman(
                          Math.round(inv.payment?.cash || 0) + Math.round(inv.payment?.card || 0)
                        )}
                      </div>
                    )}
                    {(inv.payment?.credit || 0) <= 0 &&
                      (Math.round(inv.payment?.cash || 0) + Math.round(inv.payment?.card || 0) > 0 ||
                        inv.isPaid) && (
                        <div className="ios-caption" style={{ color: 'var(--ion-color-success)' }}>
                          تسویه‌شده — پرداخت‌شده{' '}
                          {formatToman(
                            Math.round(inv.payment?.cash || 0) + Math.round(inv.payment?.card || 0) ||
                              inv.totalAmount
                          )}
                        </div>
                      )}
                    {(inv.shippedAt || inv.paidAt || inv.lastPaymentAt) && (
                      <div className="ios-caption" style={{ marginTop: 4 }}>
                        {inv.shippedAt ? `ارسال ${formatDate(inv.shippedAt)}` : ''}
                        {inv.shippedAt && (inv.paidAt || inv.lastPaymentAt) ? ' · ' : ''}
                        {inv.paidAt || inv.lastPaymentAt
                          ? `پرداخت ${formatDate(inv.paidAt || inv.lastPaymentAt!)}`
                          : ''}
                      </div>
                    )}
                    {(inv.items || []).slice(0, 3).map((it, i) => {
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
                    {(() => {
                      const s = summarizeSaleItems(inv.items);
                      if (!s.lineCount) return null;
                      return (
                        <div className="ios-caption" style={{ marginTop: 4 }}>
                          {s.lineCount.toLocaleString('fa-IR')} قلم ·{' '}
                          {formatKg(inv.totalKg || s.totalKg)}
                          {s.packageCount > 0
                            ? ` · ${s.packageCount.toLocaleString('fa-IR')} بسته`
                            : ''}
                        </div>
                      );
                    })()}
                    <div className="inv-card-actions">
                      <IonButton size="small" fill="clear" onClick={() => setInvDetail(inv)}>
                        <IonIcon slot="start" icon={eyeOutline} />
                        جزئیات
                      </IonButton>
                      <IonButton
                        size="small"
                        fill="clear"
                        onClick={() => void copyInvoiceReport(inv)}
                      >
                        <IonIcon slot="start" icon={copyOutline} />
                        کپی گزارش
                      </IonButton>
                      {isAdmin && inv._id && (
                        <IonButton
                          size="small"
                          fill="clear"
                          color="warning"
                          onClick={() => startInvoiceEdit(inv)}
                        >
                          <IonIcon slot="start" icon={createOutline} />
                          ویرایش
                        </IonButton>
                      )}
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

        {/* ویرایش اطلاعات مشتری */}
        <IonModal isOpen={editOpen} onDidDismiss={() => setEditOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>ویرایش مشتری</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setEditOpen(false)}>بستن</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem lines="full">
              <IonLabel position="stacked">نام</IonLabel>
              <IonInput value={editName} onIonInput={(e) => setEditName(e.detail.value || '')} />
            </IonItem>
            <DigitInput
              label="شماره موبایل"
              mode="phone"
              value={editPhone}
              onChange={setEditPhone}
              placeholder="09…"
            />
            <AddressMapField
              label="آدرس و نقشه"
              address={editAddress}
              onAddressChange={setEditAddress}
              lat={editLat}
              lng={editLng}
              onLocationChange={({ lat: la, lng: ln, address: street }) => {
                setEditLat(la);
                setEditLng(ln);
                if (street) setEditAddress(street);
              }}
            />
            <IonItem lines="full">
              <IonLabel position="stacked">یادداشت</IonLabel>
              <IonInput value={editNotes} onIonInput={(e) => setEditNotes(e.detail.value || '')} />
            </IonItem>
            <IonButton
              expand="block"
              className="ios-primary-btn ion-margin-top"
              disabled={savingEdit || !editName.trim()}
              onClick={() => void saveCustomerEdit()}
            >
              <IonIcon slot="start" icon={saveOutline} />
              {savingEdit ? '…' : 'ذخیره تغییرات'}
            </IonButton>
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
                <SaleInvoiceDetailBody
                  inv={{
                    ...invDetail,
                    customerName: invDetail.customerName || selected?.name,
                    customerPhone: invDetail.customerPhone || selected?.phone,
                    customerAddress: invDetail.customerAddress || selected?.address,
                  }}
                />
                {isAdmin && invDetail._id && (
                  <IonButton
                    expand="block"
                    color="warning"
                    className="ion-margin-top"
                    onClick={() => startInvoiceEdit(invDetail)}
                  >
                    <IonIcon slot="start" icon={createOutline} />
                    ویرایش فاکتور و نسیه
                  </IonButton>
                )}
              </>
            )}
          </IonContent>
        </IonModal>

        {seedEdit && (
          <InvoiceListPanel
            kind="sale"
            editOnly
            seedEdit={seedEdit}
            onSeedEditDone={() => void onInvoiceEditDone()}
            onToast={(msg, color) => setToast({ open: true, msg, color: color || 'success' })}
          />
        )}

        <IonAlert
          isOpen={deleteConfirm}
          onDidDismiss={() => setDeleteConfirm(false)}
          header="حذف مشتری"
          message="مشتری بدون نسیه باز حذف می‌شود. فاکتورهای قبلی در سیستم می‌مانند."
          buttons={[
            { text: 'انصراف', role: 'cancel' },
            {
              text: 'حذف',
              role: 'destructive',
              handler: () => {
                void deleteCustomerNow();
              },
            },
          ]}
        />

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
