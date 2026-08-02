import { useCallback, useEffect, useState } from 'react';
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
import { formatToman, formatKg, formatDate, formatMoneyInput, parseAmount } from '../utils/format';
import { useAuth } from '../auth/AuthContext';

export interface SaleInvRow {
  _id: string;
  invoiceNumber: string;
  customerName?: string;
  customerPhone?: string;
  totalAmount: number;
  totalKg?: number;
  totalProfit?: number;
  discount?: number;
  status?: string;
  isGolden?: boolean;
  paymentMethod?: string;
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
  shipped: 'ارسال شد',
  delivered: 'تحویل شد',
  cancelled: 'لغو',
};

const PAY: Record<string, string> = {
  cash: 'نقد',
  card: 'پوز',
  card_to_card: 'کارت به کارت',
  credit: 'نسیه',
  mixed: 'ترکیبی',
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
  const [editDiscount, setEditDiscount] = useState('');
  const [editSaleItems, setEditSaleItems] = useState<EditSaleItem[]>([]);
  const [editPurchaseItems, setEditPurchaseItems] = useState<EditPurchaseItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (kind === 'sale') {
        const list = await wsClient.request<SaleInvRow[]>('sale.list', {});
        setSales(Array.isArray(list) ? list : []);
      } else {
        const list = await wsClient.request<PurchaseInvRow[]>('purchase.list', {});
        setPurchases(Array.isArray(list) ? list : []);
      }
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'خطا در لود فاکتورها', 'danger');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onToast is unstable inline
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === kind || p?.entity === 'sale' || p?.entity === 'purchase') {
        void load();
      }
    });
    return unsub;
  }, [kind, load]);

  const list = kind === 'sale' ? sales : purchases;

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
      setEditPaymentMethod(s.paymentMethod || 'cash');
      setEditDiscount(s.discount ? formatMoneyInput(String(s.discount)) : '');
      setEditSaleItems(
        (s.items || []).map((it) => {
          const unit = it.unit || 'kg';
          const unitPrice =
            it.unitPrice ??
            (unit === 'kg' ? it.unitPricePerKg : undefined) ??
            (it.qtyKg > 0 ? Math.round(it.totalPrice / it.qtyKg) : 0);
          return {
            productId: it.productId,
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
            productId: it.productId,
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
        await wsClient.request('sale.update', {
          id: detail._id,
          password: editPw,
          customerName: editCustomerName.trim() || undefined,
          customerPhone: editCustomerPhone.trim() || undefined,
          notes: editNotes.trim() || undefined,
          paymentMethod: editPaymentMethod,
          discount: parseAmount(editDiscount) || 0,
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
        همه فاکتورهای {kind === 'sale' ? 'فروش' : 'خرید'}
        {loading ? ' …' : ` (${list.length})`}
      </div>
      <div className="ios-glass-card">
        {loading && list.length === 0 && (
          <div style={{ textAlign: 'center', padding: 12 }}>
            <IonSpinner name="crescent" />
          </div>
        )}
        {!loading && list.length === 0 && <p className="hint">فاکتوری ثبت نشده</p>}

        {kind === 'sale' &&
          (list as SaleInvRow[]).slice(0, 50).map((inv) => (
            <div key={inv._id} className="day-row inv-row">
              <div className="ios-row">
                <div>
                  <strong className={inv.isGolden ? 'gold-text' : ''}>
                    {inv.isGolden ? '⭐ ' : ''}
                    {inv.invoiceNumber}
                  </strong>
                  <div className="ios-caption">
                    {formatDate(inv.date)} · {inv.customerName || 'بدون مشتری'}
                  </div>
                  <div className="chip-row" style={{ marginTop: 4 }}>
                    {inv.status && (
                      <IonChip outline className="tiny-chip">
                        {STATUS[inv.status] || inv.status}
                      </IonChip>
                    )}
                    {inv.paymentMethod && (
                      <IonChip outline className="tiny-chip">
                        {PAY[inv.paymentMethod] || inv.paymentMethod}
                      </IonChip>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div className="stat-value">{formatToman(inv.totalAmount)}</div>
                  <div className="ios-caption">{formatKg(inv.totalKg || 0)}</div>
                </div>
              </div>
              <div className="chip-row">
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
                    <IonButton
                      size="small"
                      fill="clear"
                      color="warning"
                      onClick={() => openEdit(inv)}
                    >
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
          (list as PurchaseInvRow[]).slice(0, 50).map((inv) => (
            <div key={inv._id} className="day-row inv-row">
              <div className="ios-row">
                <div>
                  <strong>{inv.invoiceNumber || 'خرید'}</strong>
                  <div className="ios-caption">
                    {formatDate(inv.date)} · {inv.supplier || 'شرکت'}
                    {inv.paidNow ? ' · پرداخت‌شده' : ' · نسیه شرکت'}
                  </div>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div className="stat-value">{formatToman(inv.totalAmount)}</div>
                  <div className="ios-caption">{formatKg(inv.totalKg || 0)}</div>
                </div>
              </div>
              <div className="chip-row">
                <IonButton size="small" fill="clear" onClick={() => setDetail(inv)}>
                  <IonIcon slot="start" icon={eyeOutline} />
                  جزئیات
                </IonButton>
                {isAdmin && (
                  <>
                    <IonButton
                      size="small"
                      fill="clear"
                      color="warning"
                      onClick={() => openEdit(inv)}
                    >
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
        isOpen={!!detail && !deleteOpen && !editOpen}
        onDidDismiss={() => {
          if (!deleteOpen && !editOpen) setDetail(null);
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
              </p>
              <p>
                <b>مشتری:</b> {(detail as SaleInvRow).customerName || '—'}
              </p>
              <p>
                <b>تاریخ:</b> {formatDate(detail.date)}
              </p>
              <p>
                <b>مبلغ:</b> {formatToman(detail.totalAmount)}
              </p>
              <p>
                <b>تناژ:</b> {formatKg((detail as SaleInvRow).totalKg || 0)}
              </p>
              <p>
                <b>وضعیت:</b>{' '}
                {STATUS[(detail as SaleInvRow).status || ''] || (detail as SaleInvRow).status || '—'}
              </p>
              {(detail as SaleInvRow).items?.length ? (
                <div className="ios-glass-card">
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    اقلام
                  </div>
                  {(detail as SaleInvRow).items!.map((it, i) => (
                    <div key={i} className="stat-row">
                      <span>
                        {it.productName} · {formatKg(it.qtyKg)}
                      </span>
                      <span>{formatToman(it.totalPrice)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
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
                  {(detail as PurchaseInvRow).items!.map((it, i) => (
                    <div key={i} className="stat-row">
                      <span>
                        {it.productName} · {formatKg(it.qtyKg)}
                      </span>
                      <span>{formatToman(it.totalPrice)}</span>
                    </div>
                  ))}
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
              <IonItem>
                <IonLabel position="stacked">تلفن</IonLabel>
                <IonInput
                  value={editCustomerPhone}
                  onIonInput={(e) => setEditCustomerPhone(e.detail.value || '')}
                />
              </IonItem>
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
              <IonItem>
                <IonLabel position="stacked">تخفیف فاکتور (تومان)</IonLabel>
                <IonInput
                  inputMode="numeric"
                  value={editDiscount}
                  onIonInput={(e) => setEditDiscount(formatMoneyInput(e.detail.value || ''))}
                />
              </IonItem>
              {editSaleItems.map((it, idx) => (
                <div key={idx} className="ios-glass-card" style={{ marginTop: 10 }}>
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    {it.productName}
                  </div>
                  <IonItem>
                    <IonLabel position="stacked">
                      مقدار ({it.unit === 'package' ? 'بسته' : 'کیلو'})
                    </IonLabel>
                    <IonInput
                      type="number"
                      value={it.qtyInput}
                      onIonInput={(e) => {
                        const v = e.detail.value || '';
                        setEditSaleItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, qtyInput: v } : row))
                        );
                      }}
                    />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">قیمت واحد (تومان)</IonLabel>
                    <IonInput
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
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    {it.productName}
                  </div>
                  <IonItem>
                    <IonLabel position="stacked">
                      مقدار ({it.unit === 'package' ? 'بسته' : 'کیلو'})
                    </IonLabel>
                    <IonInput
                      type="number"
                      value={it.qtyInput}
                      onIonInput={(e) => {
                        const v = e.detail.value || '';
                        setEditPurchaseItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, qtyInput: v } : row))
                        );
                      }}
                    />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">قیمت واحد (تومان)</IonLabel>
                    <IonInput
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
              placeholder="رمز"
            />
          </IonItem>
          <IonButton
            expand="block"
            color="warning"
            className="ion-margin-top"
            disabled={saving || !editPw}
            onClick={() => void confirmEdit()}
          >
            {saving ? '…' : 'ذخیره تغییرات'}
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
