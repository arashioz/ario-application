import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonButton,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonModal,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
  IonButtons,
} from '@ionic/react';
import { createOutline, eyeOutline, trashOutline, documentOutline } from 'ionicons/icons';
import { wsClient } from '../api/ws';
import {
  formatToman,
  formatKg,
  formatDate,
  formatMoneyInput,
  parseAmount,
  normalizePhone,
  INVOICE_PERIODS,
  periodRange,
  InvoicePeriod,
} from '../utils/format';
import { buildInvoiceShareText, copyText, pickDefaultBankCard } from '../utils/invoiceShare';
import { useAuth } from '../auth/AuthContext';
import { DigitInput } from './DigitInput';
import { QtyStepper } from './QtyStepper';

export interface SaleInvRow {
  _id: string;
  invoiceNumber: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  totalAmount: number;
  totalKg?: number;
  totalProfit?: number;
  discount?: number;
  status?: string;
  isGolden?: boolean;
  paymentMethod?: string;
  payment?: { cash?: number; card?: number; credit?: number };
  priceTier?: string;
  date: string;
  items?: Array<{
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
  }>;
  notes?: string;
  shippingNotes?: string;
}

export interface PurchaseInvRow {
  _id: string;
  invoiceNumber?: string;
  supplier?: string;
  totalAmount: number;
  totalKg?: number;
  paidNow?: boolean;
  date: string;
  notes?: string;
  items?: Array<{
    productId?: string;
    productName: string;
    qtyKg: number;
    totalPrice: number;
    unit?: 'kg' | 'package';
    qtyInput?: number;
    unitPrice?: number;
    unitPricePerKg?: number;
    kgPerPackage?: number;
  }>;
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

type EditSaleItem = {
  productId?: string;
  productName: string;
  unit: 'kg' | 'package';
  qtyInput: string;
  unitPrice: string;
  discount: string;
  kgPerPackage: number;
};

type EditPurchaseItem = {
  productId?: string;
  productName: string;
  unit: 'kg' | 'package';
  qtyInput: string;
  unitPrice: string;
  kgPerPackage: number;
};

type Props = {
  kind: 'sale' | 'purchase';
  /** افزایش بده تا لیست رفرش شود (مثلاً بعد از ثبت) */
  refreshKey?: number;
  onToast?: (msg: string, color?: string) => void;
};

export const InvoiceListPanel: React.FC<Props> = ({ kind, refreshKey = 0, onToast }) => {
  const { isAdmin } = useAuth();
  const [period, setPeriod] = useState<InvoicePeriod>('today');
  const [sales, setSales] = useState<SaleInvRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseInvRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<SaleInvRow | PurchaseInvRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editPw, setEditPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [editSupplier, setEditSupplier] = useState('');
  const [editPaidNow, setEditPaidNow] = useState(false);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState('cash');
  const [editPayCash, setEditPayCash] = useState('');
  const [editPayCard, setEditPayCard] = useState('');
  const [editPayCredit, setEditPayCredit] = useState('');
  const [editDiscount, setEditDiscount] = useState('');
  const [editCustomerAddress, setEditCustomerAddress] = useState('');
  const [editPriceTier, setEditPriceTier] = useState<'retail' | 'supermarket' | 'wholesale'>('retail');
  const [editSaleItems, setEditSaleItems] = useState<EditSaleItem[]>([]);
  const [editPurchaseItems, setEditPurchaseItems] = useState<EditPurchaseItem[]>([]);
  const [productOptions, setProductOptions] = useState<
    Array<{ _id: string; name: string; kgPerPackage?: number; stockKg?: number }>
  >([]);
  const [addProductId, setAddProductId] = useState('');
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivatePw, setDeactivatePw] = useState('');
  const [deactivating, setDeactivating] = useState(false);

  const bumpSaleQty = (idx: number, next: string) => {
    setEditSaleItems((prev) => prev.map((row, i) => (i === idx ? { ...row, qtyInput: next } : row)));
  };
  const bumpPurchaseQty = (idx: number, next: string) => {
    setEditPurchaseItems((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, qtyInput: next } : row))
    );
  };

  const loadProducts = async () => {
    try {
      const list = await wsClient.request<typeof productOptions>('product.list', {});
      setProductOptions(Array.isArray(list) ? list : []);
    } catch {
      setProductOptions([]);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const range = periodRange(period);
      if (kind === 'sale') {
        const list = await wsClient.request<SaleInvRow[]>('sale.list', range);
        setSales(Array.isArray(list) ? list : []);
      } else {
        const list = await wsClient.request<PurchaseInvRow[]>('purchase.list', range);
        setPurchases(Array.isArray(list) ? list : []);
      }
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'خطا در لود فاکتورها', 'danger');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onToast is unstable inline
  }, [kind, period]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const list = kind === 'sale' ? sales : purchases;
  const summary = useMemo(() => {
    const rows = list as Array<{ totalAmount?: number; totalKg?: number }>;
    return {
      count: rows.length,
      amount: rows.reduce((s, r) => s + (r.totalAmount || 0), 0),
      kg: rows.reduce((s, r) => s + (r.totalKg || 0), 0),
    };
  }, [list]);
  useEffect(() => {
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === kind || p?.entity === 'sale' || p?.entity === 'purchase') {
        void load();
      }
    });
    return unsub;
  }, [kind, load]);

  const openPdf = async (id: string) => {
    try {
      const res = await wsClient.request<{ html: string }>('sale.pdf', { id });
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(res.html);
        w.document.close();
      }
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'PDF ساخته نشد', 'danger');
    }
  };

  const openEdit = (inv: SaleInvRow | PurchaseInvRow) => {
    setDetail(inv);
    setEditPw('');
    setEditNotes(inv.notes || '');
    if (kind === 'sale') {
      const s = inv as SaleInvRow;
      setEditCustomerName(s.customerName || '');
      setEditCustomerPhone(s.customerPhone || '');
      setEditCustomerAddress(s.customerAddress || '');
      setEditPaymentMethod(s.paymentMethod || 'cash');
      setEditPriceTier(
        s.priceTier === 'supermarket' || s.priceTier === 'wholesale' ? s.priceTier : 'retail'
      );
      setEditPayCash(s.payment?.cash ? formatMoneyInput(String(s.payment.cash)) : '');
      setEditPayCard(s.payment?.card ? formatMoneyInput(String(s.payment.card)) : '');
      setEditPayCredit(s.payment?.credit ? formatMoneyInput(String(s.payment.credit)) : '');
      setEditDiscount(s.discount ? formatMoneyInput(String(s.discount)) : '');
      setAddProductId('');
      void loadProducts();
      setEditSaleItems(
        (s.items || []).map((it) => {
          const unit = it.unit || 'kg';
          const unitPrice =
            it.unitPrice ??
            (unit === 'kg' ? it.unitPricePerKg : undefined) ??
            (it.qtyKg > 0 ? Math.round(it.totalPrice / it.qtyKg) : 0);
          return {
            productId: it.productId ? String(it.productId) : '',
            productName: it.productName,
            unit,
            qtyInput: String(it.qtyInput ?? it.qtyKg ?? 0),
            unitPrice: formatMoneyInput(String(unitPrice || 0)),
            discount: it.discount ? formatMoneyInput(String(it.discount)) : '',
            kgPerPackage: it.kgPerPackage || 5,
          };
        })
      );
    } else {
      const p = inv as PurchaseInvRow;
      setEditSupplier(p.supplier || 'شرکت');
      setEditPaidNow(!!p.paidNow);
      setEditPurchaseItems(
        (p.items || []).map((it) => {
          const unit = it.unit || 'kg';
          const unitPrice =
            it.unitPrice ??
            (unit === 'kg' ? it.unitPricePerKg : undefined) ??
            (it.qtyKg > 0 ? Math.round(it.totalPrice / it.qtyKg) : 0);
          return {
            productId: it.productId ? String(it.productId) : '',
            productName: it.productName,
            unit,
            qtyInput: String(it.qtyInput ?? it.qtyKg ?? 0),
            unitPrice: formatMoneyInput(String(unitPrice || 0)),
            kgPerPackage: it.kgPerPackage || 5,
          };
        })
      );
    }
    setEditOpen(true);
  };

  const confirmDelete = async () => {
    if (!detail) return;
    setDeleting(true);
    try {
      if (kind === 'sale') {
        await wsClient.request('sale.delete', { id: detail._id, password: deletePw });
      } else {
        await wsClient.request('purchase.delete', { id: detail._id, password: deletePw });
      }
      onToast?.('فاکتور حذف شد', 'success');
      setDeleteOpen(false);
      setDetail(null);
      setDeletePw('');
      await load();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'حذف نشد', 'danger');
    } finally {
      setDeleting(false);
    }
  };

  const confirmEdit = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      if (kind === 'sale') {
        const items = editSaleItems.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          unit: it.unit,
          qtyInput: parseFloat(it.qtyInput) || 0,
          unitPrice: parseAmount(it.unitPrice) || 0,
          discount: parseAmount(it.discount) || 0,
          kgPerPackage: it.kgPerPackage,
        }));
        if (items.some((it) => it.qtyInput <= 0)) throw new Error('مقدار اقلام باید بیشتر از صفر باشد');
        if (!items.length) throw new Error('حداقل یک قلم لازم است');
        const payPayload =
          editPaymentMethod === 'mixed'
            ? {
                cash: parseAmount(editPayCash) || 0,
                card: parseAmount(editPayCard) || 0,
                credit: parseAmount(editPayCredit) || 0,
              }
            : undefined;
        await wsClient.request('sale.update', {
          id: detail._id,
          password: editPw,
          customerName: editCustomerName.trim() || undefined,
          customerPhone: editCustomerPhone ? normalizePhone(editCustomerPhone) || undefined : undefined,
          customerAddress: editCustomerAddress.trim() || undefined,
          notes: editNotes.trim() || undefined,
          paymentMethod: editPaymentMethod,
          payment: payPayload,
          discount: parseAmount(editDiscount) || 0,
          priceTier: editPriceTier,
          items,
        });
      } else {
        const items = editPurchaseItems.map((it) => ({
          productId: it.productId,
          name: it.productName,
          unit: it.unit,
          qtyInput: parseFloat(it.qtyInput) || 0,
          unitPrice: parseAmount(it.unitPrice) || 0,
          kgPerPackage: it.kgPerPackage,
        }));
        if (items.some((it) => it.qtyInput <= 0)) throw new Error('مقدار اقلام باید بیشتر از صفر باشد');
        await wsClient.request('purchase.update', {
          id: detail._id,
          password: editPw,
          supplier: editSupplier.trim() || undefined,
          notes: editNotes.trim() || undefined,
          paidNow: editPaidNow,
          items,
        });
      }
      onToast?.('فاکتور ویرایش شد', 'success');
      setEditOpen(false);
      setDetail(null);
      setEditPw('');
      await load();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'ویرایش نشد', 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="ios-section-title" style={{ marginTop: 20 }}>
        فاکتورهای {kind === 'sale' ? 'فروش' : 'خرید'}
        {loading ? ' …' : ''}
      </div>

      <div className="chip-row inv-period-row">
        {INVOICE_PERIODS.map((p) => (
          <IonChip
            key={p.value}
            className={period === p.value ? 'ios-chip-active' : 'ios-chip'}
            onClick={() => setPeriod(p.value)}
          >
            {p.label}
          </IonChip>
        ))}
      </div>

      <div className="inv-summary-bar">
        <div>
          <span className="inv-sum-label">تعداد</span>
          <strong>{summary.count.toLocaleString('fa-IR')}</strong>
        </div>
        <div>
          <span className="inv-sum-label">مبلغ</span>
          <strong>{formatToman(summary.amount)}</strong>
        </div>
        <div>
          <span className="inv-sum-label">تناژ</span>
          <strong>{formatKg(summary.kg)}</strong>
        </div>
      </div>

      <div className="inv-card-list">
        {loading && list.length === 0 && (
          <div style={{ textAlign: 'center', padding: 12 }}>
            <IonSpinner name="crescent" />
          </div>
        )}
        {!loading && list.length === 0 && <p className="hint">در این بازه فاکتوری نیست</p>}

        {kind === 'sale' &&
          (list as SaleInvRow[]).slice(0, 80).map((inv) => (
            <div key={inv._id} className={`inv-card${inv.isGolden ? ' gold' : ''}`}>
              <div className="inv-card-top">
                <div>
                  <div className="inv-card-num">
                    {inv.isGolden ? '⭐ ' : ''}
                    {inv.invoiceNumber}
                  </div>
                  <div className="inv-card-meta">
                    {formatDate(inv.date)} · {inv.customerName || 'بدون مشتری'}
                  </div>
                </div>
                <div className="inv-card-amount">
                  <div className="inv-card-money">{formatToman(inv.totalAmount)}</div>
                  <div className="inv-card-kg">{formatKg(inv.totalKg || 0)}</div>
                </div>
              </div>
              <div className="chip-row">
                {inv.status && (
                  <span className={`inv-badge st-${inv.status}`}>
                    {STATUS[inv.status] || inv.status}
                  </span>
                )}
                {inv.paymentMethod && (
                  <span className="inv-badge pay">{PAY[inv.paymentMethod] || inv.paymentMethod}</span>
                )}
              </div>
              <div className="inv-card-actions">
                <IonButton size="small" fill="clear" onClick={() => setDetail(inv)}>
                  <IonIcon slot="start" icon={eyeOutline} />
                  جزئیات
                </IonButton>
                <IonButton size="small" fill="outline" onClick={() => void openPdf(inv._id)}>
                  <IonIcon slot="start" icon={documentOutline} />
                  PDF
                </IonButton>
                {isAdmin && (
                  <>
                    <IonButton size="small" fill="clear" color="warning" onClick={() => openEdit(inv)}>
                      <IonIcon slot="start" icon={createOutline} />
                      ویرایش
                    </IonButton>
                    <IonButton
                      size="small"
                      fill="clear"
                      color="danger"
                      onClick={() => {
                        setDetail(inv);
                        setDeleteOpen(true);
                      }}
                    >
                      <IonIcon slot="start" icon={trashOutline} />
                      حذف
                    </IonButton>
                  </>
                )}
              </div>
            </div>
          ))}

        {kind === 'purchase' &&
          (list as PurchaseInvRow[]).slice(0, 80).map((inv) => (
            <div key={inv._id} className="inv-card">
              <div className="inv-card-top">
                <div>
                  <div className="inv-card-num">{inv.invoiceNumber || 'خرید'}</div>
                  <div className="inv-card-meta">
                    {formatDate(inv.date)} · {inv.supplier || 'شرکت'}
                    {inv.paidNow ? ' · پرداخت‌شده' : ' · نسیه شرکت'}
                  </div>
                </div>
                <div className="inv-card-amount">
                  <div className="inv-card-money">{formatToman(inv.totalAmount)}</div>
                  <div className="inv-card-kg">{formatKg(inv.totalKg || 0)}</div>
                </div>
              </div>
              <div className="inv-card-actions">
                <IonButton size="small" fill="clear" onClick={() => setDetail(inv)}>
                  <IonIcon slot="start" icon={eyeOutline} />
                  جزئیات
                </IonButton>
                {isAdmin && (
                  <>
                    <IonButton size="small" fill="clear" color="warning" onClick={() => openEdit(inv)}>
                      <IonIcon slot="start" icon={createOutline} />
                      ویرایش
                    </IonButton>
                    <IonButton
                      size="small"
                      fill="clear"
                      color="danger"
                      onClick={() => {
                        setDetail(inv);
                        setDeleteOpen(true);
                      }}
                    >
                      <IonIcon slot="start" icon={trashOutline} />
                      حذف
                    </IonButton>
                  </>
                )}
              </div>
            </div>
          ))}

        <IonButton expand="block" fill="outline" size="small" onClick={() => void load()}>
          بروزرسانی لیست
        </IonButton>
      </div>

      <IonModal
        isOpen={!!detail && !deleteOpen && !editOpen && !deactivateOpen}
        onDidDismiss={() => {
          if (!deleteOpen && !editOpen && !deactivateOpen) setDetail(null);
        }}
      >
        <IonHeader>
          <IonToolbar>
            <IonTitle>جزئیات فاکتور</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setDetail(null)}>بستن</IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          {detail && kind === 'sale' && (
            <>
              <p>
                <b>شماره:</b> {(detail as SaleInvRow).invoiceNumber}
                {(detail as SaleInvRow).isGolden ? ' ⭐ طلایی' : ''}
              </p>
              <p>
                <b>مشتری:</b> {(detail as SaleInvRow).customerName || '—'}
                {(detail as SaleInvRow).customerPhone
                  ? ` · ${(detail as SaleInvRow).customerPhone}`
                  : ''}
              </p>
              {(detail as SaleInvRow).customerAddress ? (
                <p>
                  <b>آدرس:</b> {(detail as SaleInvRow).customerAddress}
                </p>
              ) : null}
              <p>
                <b>تاریخ:</b> {formatDate(detail.date)}
              </p>
              <p>
                <b>مبلغ:</b> {formatToman(detail.totalAmount)}
              </p>
              <p>
                <b>تناژ:</b> {formatKg((detail as SaleInvRow).totalKg || 0)}
              </p>
              {(detail as SaleInvRow).totalProfit != null ? (
                <p>
                  <b>سود:</b> {formatToman((detail as SaleInvRow).totalProfit || 0)}
                </p>
              ) : null}
              {(detail as SaleInvRow).discount ? (
                <p>
                  <b>تخفیف:</b> {formatToman((detail as SaleInvRow).discount || 0)}
                </p>
              ) : null}
              {(detail as SaleInvRow).priceTier ? (
                <p>
                  <b>سطح قیمت:</b>{' '}
                  {TIER[(detail as SaleInvRow).priceTier || ''] || (detail as SaleInvRow).priceTier}
                </p>
              ) : null}
              {(detail as SaleInvRow).paymentMethod ? (
                <p>
                  <b>روش پرداخت:</b>{' '}
                  {PAY[(detail as SaleInvRow).paymentMethod || ''] ||
                    (detail as SaleInvRow).paymentMethod}
                </p>
              ) : null}
              {(detail as SaleInvRow).payment && (
                <div className="ios-glass-card">
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    جزئیات پرداخت مشتری
                  </div>
                  <div className="stat-row">
                    <span>نقد</span>
                    <span>{formatToman((detail as SaleInvRow).payment?.cash || 0)}</span>
                  </div>
                  <div className="stat-row">
                    <span>پوز / کارت</span>
                    <span>{formatToman((detail as SaleInvRow).payment?.card || 0)}</span>
                  </div>
                  <div className="stat-row">
                    <span>نسیه</span>
                    <span className="warning">
                      {formatToman((detail as SaleInvRow).payment?.credit || 0)}
                    </span>
                  </div>
                </div>
              )}
              <p>
                <b>وضعیت:</b>{' '}
                {STATUS[(detail as SaleInvRow).status || ''] || (detail as SaleInvRow).status || '—'}
              </p>
              {(detail as SaleInvRow).shippingNotes ? (
                <p>
                  <b>ارسال:</b> {(detail as SaleInvRow).shippingNotes}
                </p>
              ) : null}
              {(detail as SaleInvRow).items?.length ? (
                <div className="ios-glass-card">
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    اقلام و فی قند
                  </div>
                  {(detail as SaleInvRow).items!.map((it, i) => {
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
                          {formatKg(it.qtyKg)}
                          {it.unit === 'package' && it.qtyInput
                            ? ` · ${it.qtyInput} بسته`
                            : ''}
                          {' · '}
                          فی {formatToman(perKg)}/کیلو
                          {it.discount ? ` · تخفیف ${formatToman(it.discount)}` : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <IonButton
                expand="block"
                fill="outline"
                onClick={() => {
                  const inv = detail as SaleInvRow;
                  void (async () => {
                    let defaultCard:
                      | {
                          label: string;
                          cardNumber: string;
                          accountHolder?: string;
                          bankName?: string;
                        }
                      | undefined;
                    try {
                      const s = await wsClient.request<{
                        bankCards?: Array<{
                          label: string;
                          cardNumber: string;
                          accountHolder?: string;
                          bankName?: string;
                          isDefault?: boolean;
                        }>;
                      }>('settings.get');
                      const picked = pickDefaultBankCard(s.bankCards || []);
                      if (picked) {
                        defaultCard = {
                          label: picked.label,
                          cardNumber: picked.cardNumber,
                          accountHolder: picked.accountHolder,
                          bankName: picked.bankName,
                        };
                      }
                    } catch {
                      /* ignore */
                    }
                    const text = buildInvoiceShareText(
                      {
                        invoiceNumber: inv.invoiceNumber,
                        customerName: inv.customerName,
                        customerPhone: inv.customerPhone,
                        date: inv.date,
                        totalAmount: inv.totalAmount,
                        totalKg: inv.totalKg,
                        discount: inv.discount,
                        paymentMethod: inv.paymentMethod,
                        isGolden: inv.isGolden,
                        items: inv.items,
                      },
                      defaultCard ? { defaultCard } : undefined
                    );
                    const ok = await copyText(text);
                    onToast?.(
                      ok ? 'متن فاکتور با کارت پیش‌فرض کپی شد' : 'کپی نشد',
                      ok ? 'success' : 'danger'
                    );
                  })();
                }}
              >
                کپی متن برای مشتری
              </IonButton>
              <IonButton expand="block" onClick={() => void openPdf(detail._id)}>
                چاپ / PDF
              </IonButton>
              {isAdmin && (
                <>
                  <IonButton
                    expand="block"
                    color="warning"
                    fill="outline"
                    className="ion-margin-top"
                    onClick={() => openEdit(detail)}
                  >
                    ویرایش با رمز
                  </IonButton>
                  {((detail as SaleInvRow).status === 'pending' ||
                    (detail as SaleInvRow).status === 'approved') && (
                    <IonButton
                      expand="block"
                      color="medium"
                      fill="outline"
                      className="ion-margin-top"
                      onClick={() => {
                        setDeactivatePw('');
                        setDeactivateOpen(true);
                      }}
                    >
                      غیرفعال (بدون حذف)
                    </IonButton>
                  )}
                  <IonButton
                    expand="block"
                    color="danger"
                    fill="outline"
                    className="ion-margin-top"
                    onClick={() => setDeleteOpen(true)}
                  >
                    حذف با رمز
                  </IonButton>
                </>
              )}
            </>
          )}
          {detail && kind === 'purchase' && (
            <>
              <p>
                <b>شماره:</b> {(detail as PurchaseInvRow).invoiceNumber || '—'}
              </p>
              <p>
                <b>تأمین‌کننده:</b> {(detail as PurchaseInvRow).supplier || '—'}
              </p>
              <p>
                <b>تاریخ:</b> {formatDate(detail.date)}
              </p>
              <p>
                <b>مبلغ:</b> {formatToman(detail.totalAmount)}
              </p>
              <p>
                <b>پرداخت:</b> {(detail as PurchaseInvRow).paidNow ? 'نقد الان' : 'نسیه / بدهی شرکت'}
              </p>
              {(detail as PurchaseInvRow).items?.length ? (
                <div className="ios-glass-card">
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    اقلام
                  </div>
                  {(detail as PurchaseInvRow).items!.map((it, i) => {
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
                          {formatKg(it.qtyKg)}
                          {it.unit === 'package' && it.qtyInput
                            ? ` · ${it.qtyInput} بسته`
                            : ''}
                          {' · '}
                          فی {formatToman(perKg)}/کیلو
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {isAdmin && (
                <>
                  <IonButton
                    expand="block"
                    color="warning"
                    fill="outline"
                    className="ion-margin-top"
                    onClick={() => openEdit(detail)}
                  >
                    ویرایش با رمز
                  </IonButton>
                  <IonButton
                    expand="block"
                    color="danger"
                    fill="outline"
                    className="ion-margin-top"
                    onClick={() => setDeleteOpen(true)}
                  >
                    حذف با رمز
                  </IonButton>
                </>
              )}
            </>
          )}
        </IonContent>
      </IonModal>

      <IonModal isOpen={editOpen} onDidDismiss={() => setEditOpen(false)}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>ویرایش فاکتور</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setEditOpen(false)}>انصراف</IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <p className="hint">مقدار و قیمت را اصلاح کنید؛ برای ذخیره رمز لازم است.</p>

          {kind === 'sale' ? (
            <>
              <IonItem>
                <IonLabel position="stacked">مشتری</IonLabel>
                <IonInput
                  value={editCustomerName}
                  onIonInput={(e) => setEditCustomerName(e.detail.value || '')}
                />
              </IonItem>
              <DigitInput
                label="تلفن"
                mode="phone"
                value={editCustomerPhone}
                onChange={setEditCustomerPhone}
                placeholder="09…"
              />
              <IonItem>
                <IonLabel position="stacked">آدرس</IonLabel>
                <IonInput
                  value={editCustomerAddress}
                  onIonInput={(e) => setEditCustomerAddress(e.detail.value || '')}
                />
              </IonItem>
              <div className="ios-section-title">نوع فاکتور (سطح قیمت)</div>
              <div className="chip-row">
                {(['retail', 'supermarket', 'wholesale'] as const).map((t) => (
                  <IonChip
                    key={t}
                    className={editPriceTier === t ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => setEditPriceTier(t)}
                  >
                    {TIER[t]}
                  </IonChip>
                ))}
              </div>
              <IonItem>
                <IonLabel position="stacked">روش پرداخت</IonLabel>
                <IonSelect
                  value={editPaymentMethod}
                  onIonChange={(e) => setEditPaymentMethod(String(e.detail.value))}
                  interface="popover"
                >
                  <IonSelectOption value="cash">نقد</IonSelectOption>
                  <IonSelectOption value="card">پوز</IonSelectOption>
                  <IonSelectOption value="card_to_card">کارت به کارت</IonSelectOption>
                  <IonSelectOption value="credit">نسیه</IonSelectOption>
                  <IonSelectOption value="mixed">ترکیبی</IonSelectOption>
                </IonSelect>
              </IonItem>
              {editPaymentMethod === 'mixed' && (
                <div className="ios-glass-card" style={{ marginTop: 8 }}>
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    ترکیب پرداخت
                  </div>
                  <IonItem>
                    <IonLabel position="stacked">نقد</IonLabel>
                    <IonInput
                      inputMode="numeric"
                      value={editPayCash}
                      onIonInput={(e) => setEditPayCash(formatMoneyInput(e.detail.value || ''))}
                    />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">پوز / کارت</IonLabel>
                    <IonInput
                      inputMode="numeric"
                      value={editPayCard}
                      onIonInput={(e) => setEditPayCard(formatMoneyInput(e.detail.value || ''))}
                    />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">نسیه</IonLabel>
                    <IonInput
                      inputMode="numeric"
                      value={editPayCredit}
                      onIonInput={(e) => setEditPayCredit(formatMoneyInput(e.detail.value || ''))}
                    />
                  </IonItem>
                </div>
              )}
              <IonItem>
                <IonLabel position="stacked">تخفیف فاکتور (تومان)</IonLabel>
                <IonInput
                  inputMode="numeric"
                  value={editDiscount}
                  onIonInput={(e) => setEditDiscount(formatMoneyInput(e.detail.value || ''))}
                />
              </IonItem>

              <div className="ios-glass-card" style={{ marginTop: 10 }}>
                <div className="ios-section-title" style={{ marginTop: 0 }}>
                  افزودن محصول
                </div>
                <IonItem>
                  <IonLabel position="stacked">محصول</IonLabel>
                  <IonSelect
                    value={addProductId}
                    placeholder="انتخاب…"
                    interface="popover"
                    onIonChange={(e) => setAddProductId(String(e.detail.value || ''))}
                  >
                    {productOptions.map((p) => (
                      <IonSelectOption key={p._id} value={p._id}>
                        {p.name} ({Math.round(p.stockKg || 0)} کیلو)
                      </IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
                <IonButton
                  size="small"
                  expand="block"
                  disabled={!addProductId}
                  onClick={() => {
                    const p = productOptions.find((x) => x._id === addProductId);
                    if (!p) return;
                    if (editSaleItems.some((it) => it.productId === p._id)) {
                      onToast?.('این محصول از قبل در فاکتور هست', 'warning');
                      return;
                    }
                    setEditSaleItems((prev) => [
                      ...prev,
                      {
                        productId: p._id,
                        productName: p.name,
                        unit: 'kg',
                        qtyInput: '1',
                        unitPrice: '',
                        discount: '',
                        kgPerPackage: p.kgPerPackage || 5,
                      },
                    ]);
                    setAddProductId('');
                  }}
                >
                  افزودن به اقلام
                </IonButton>
              </div>

              {editSaleItems.map((it, idx) => (
                <div key={idx} className="ios-glass-card" style={{ marginTop: 10 }}>
                  <div className="ios-row" style={{ alignItems: 'center' }}>
                    <div className="ios-section-title" style={{ marginTop: 0, marginBottom: 0 }}>
                      {it.productName}
                    </div>
                    {editSaleItems.length > 1 && (
                      <IonButton
                        size="small"
                        fill="clear"
                        color="danger"
                        onClick={() =>
                          setEditSaleItems((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        حذف قلم
                      </IonButton>
                    )}
                  </div>
                  <div className="chip-row" style={{ marginTop: 6 }}>
                    <IonChip
                      className={it.unit === 'kg' ? 'ios-chip-active' : 'ios-chip'}
                      onClick={() =>
                        setEditSaleItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, unit: 'kg' } : row))
                        )
                      }
                    >
                      کیلو
                    </IonChip>
                    <IonChip
                      className={it.unit === 'package' ? 'ios-chip-active' : 'ios-chip'}
                      onClick={() =>
                        setEditSaleItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, unit: 'package' } : row))
                        )
                      }
                    >
                      بسته
                    </IonChip>
                  </div>
                  <p className="hint" style={{ marginBottom: 4 }}>
                    مقدار ({it.unit === 'package' ? 'بسته' : 'کیلو'})
                  </p>
                  <QtyStepper value={it.qtyInput} onChange={(v) => bumpSaleQty(idx, v)} />
                  <IonItem>
                    <IonLabel position="stacked">فی / قیمت واحد (تومان)</IonLabel>
                    <IonInput
                      type="text"
                      inputMode="numeric"
                      value={it.unitPrice}
                      onIonInput={(e) => {
                        const v = formatMoneyInput(e.detail.value || '');
                        setEditSaleItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, unitPrice: v } : row))
                        );
                      }}
                    />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">تخفیف قلم</IonLabel>
                    <IonInput
                      type="text"
                      inputMode="numeric"
                      value={it.discount}
                      onIonInput={(e) => {
                        const v = formatMoneyInput(e.detail.value || '');
                        setEditSaleItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, discount: v } : row))
                        );
                      }}
                    />
                  </IonItem>
                </div>
              ))}
            </>
          ) : (
            <>
              <IonItem>
                <IonLabel position="stacked">تأمین‌کننده</IonLabel>
                <IonInput
                  value={editSupplier}
                  onIonInput={(e) => setEditSupplier(e.detail.value || '')}
                />
              </IonItem>
              <IonItem>
                <IonLabel>پرداخت نقد الان</IonLabel>
                <IonToggle
                  checked={editPaidNow}
                  onIonChange={(e) => setEditPaidNow(e.detail.checked)}
                />
              </IonItem>
              {editPurchaseItems.map((it, idx) => (
                <div key={idx} className="ios-glass-card" style={{ marginTop: 10 }}>
                  <div className="ios-row" style={{ alignItems: 'center' }}>
                    <div className="ios-section-title" style={{ marginTop: 0, marginBottom: 0 }}>
                      {it.productName}
                    </div>
                    {editPurchaseItems.length > 1 && (
                      <IonButton
                        size="small"
                        fill="clear"
                        color="danger"
                        onClick={() =>
                          setEditPurchaseItems((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        حذف قلم
                      </IonButton>
                    )}
                  </div>
                  <div className="chip-row" style={{ marginTop: 6 }}>
                    <IonChip
                      className={it.unit === 'kg' ? 'ios-chip-active' : 'ios-chip'}
                      onClick={() =>
                        setEditPurchaseItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, unit: 'kg' } : row))
                        )
                      }
                    >
                      کیلو
                    </IonChip>
                    <IonChip
                      className={it.unit === 'package' ? 'ios-chip-active' : 'ios-chip'}
                      onClick={() =>
                        setEditPurchaseItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, unit: 'package' } : row))
                        )
                      }
                    >
                      بسته
                    </IonChip>
                  </div>
                  <p className="hint" style={{ marginBottom: 4 }}>
                    مقدار ({it.unit === 'package' ? 'بسته' : 'کیلو'})
                  </p>
                  <QtyStepper value={it.qtyInput} onChange={(v) => bumpPurchaseQty(idx, v)} />
                  <IonItem>
                    <IonLabel position="stacked">قیمت واحد (تومان)</IonLabel>
                    <IonInput
                      type="text"
                      inputMode="numeric"
                      value={it.unitPrice}
                      onIonInput={(e) => {
                        const v = formatMoneyInput(e.detail.value || '');
                        setEditPurchaseItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, unitPrice: v } : row))
                        );
                      }}
                    />
                  </IonItem>
                </div>
              ))}
            </>
          )}

          <IonItem>
            <IonLabel position="stacked">یادداشت</IonLabel>
            <IonInput value={editNotes} onIonInput={(e) => setEditNotes(e.detail.value || '')} />
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">رمز ویرایش</IonLabel>
            <IonInput
              type="password"
              value={editPw}
              onIonInput={(e) => setEditPw(e.detail.value || '')}
              placeholder="رمز حذف/ویرایش"
            />
          </IonItem>
          <IonButton
            expand="block"
            color="warning"
            className="ion-margin-top"
            disabled={saving || !editPw}
            onClick={() => void confirmEdit()}
          >
            {saving ? '…' : 'ذخیره با رمز'}
          </IonButton>
        </IonContent>
      </IonModal>

      <IonModal isOpen={deactivateOpen} onDidDismiss={() => setDeactivateOpen(false)}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>غیرفعال کردن فاکتور</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setDeactivateOpen(false)}>انصراف</IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <p className="hint">
            فاکتور پاک نمی‌شود و در تاریخچه مشتری می‌ماند، ولی از فروش/سود/موجودی محاسبه نمی‌شود.
            موجودی و صندوق برمی‌گردند.
          </p>
          <IonItem>
            <IonLabel position="stacked">رمز</IonLabel>
            <IonInput
              type="password"
              value={deactivatePw}
              onIonInput={(e) => setDeactivatePw(e.detail.value || '')}
            />
          </IonItem>
          <IonButton
            expand="block"
            color="medium"
            className="ion-margin-top"
            disabled={deactivating || !deactivatePw || !detail}
            onClick={async () => {
              if (!detail) return;
              setDeactivating(true);
              try {
                await wsClient.request('sale.deactivate', {
                  id: detail._id,
                  password: deactivatePw,
                });
                onToast?.('فاکتور غیرفعال شد', 'success');
                setDeactivateOpen(false);
                setDetail(null);
                await load();
              } catch (e) {
                onToast?.(e instanceof Error ? e.message : 'انجام نشد', 'danger');
              } finally {
                setDeactivating(false);
              }
            }}
          >
            {deactivating ? '…' : 'تأیید غیرفعال'}
          </IonButton>
        </IonContent>
      </IonModal>

      <IonModal isOpen={deleteOpen} onDidDismiss={() => setDeleteOpen(false)}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>حذف فاکتور</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setDeleteOpen(false)}>انصراف</IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <p className="hint">برای حذف، رمز حذف را وارد کنید. موجودی و صندوق برمی‌گردند.</p>
          <IonItem>
            <IonLabel position="stacked">رمز حذف</IonLabel>
            <IonInput
              type="password"
              value={deletePw}
              onIonInput={(e) => setDeletePw(e.detail.value || '')}
              placeholder="رمز حذف"
            />
          </IonItem>
          <IonButton
            expand="block"
            color="danger"
            className="ion-margin-top"
            disabled={deleting || !deletePw}
            onClick={() => void confirmDelete()}
          >
            {deleting ? '…' : 'تأیید حذف'}
          </IonButton>
        </IonContent>
      </IonModal>
    </>
  );
};

export default InvoiceListPanel;
