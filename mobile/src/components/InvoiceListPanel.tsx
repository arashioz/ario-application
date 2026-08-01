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
  IonSpinner,
  IonTitle,
  IonToolbar,
  IonButtons,
} from '@ionic/react';
import { eyeOutline, trashOutline, documentOutline } from 'ionicons/icons';
import { wsClient } from '../api/ws';
import { formatToman, formatKg, formatDate } from '../utils/format';
import { useAuth } from '../auth/AuthContext';

export interface SaleInvRow {
  _id: string;
  invoiceNumber: string;
  customerName?: string;
  customerPhone?: string;
  totalAmount: number;
  totalKg?: number;
  totalProfit?: number;
  status?: string;
  isGolden?: boolean;
  paymentMethod?: string;
  date: string;
  items?: Array<{ productName: string; qtyKg: number; totalPrice: number }>;
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
  items?: Array<{ productName: string; qtyKg: number; totalPrice: number }>;
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
                )}
              </div>
            </div>
          ))}

        <IonButton expand="block" fill="outline" size="small" onClick={() => void load()}>
          بروزرسانی لیست
        </IonButton>
      </div>

      <IonModal
        isOpen={!!detail && !deleteOpen}
        onDidDismiss={() => {
          if (!deleteOpen) setDetail(null);
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
                <IonButton
                  expand="block"
                  color="danger"
                  fill="outline"
                  className="ion-margin-top"
                  onClick={() => setDeleteOpen(true)}
                >
                  حذف با رمز
                </IonButton>
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
                <IonButton
                  expand="block"
                  color="danger"
                  fill="outline"
                  className="ion-margin-top"
                  onClick={() => setDeleteOpen(true)}
                >
                  حذف با رمز
                </IonButton>
              )}
            </>
          )}
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
