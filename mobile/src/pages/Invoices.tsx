import { useCallback, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonButton,
  IonButtons,
  IonBackButton,
  IonRefresher,
  IonRefresherContent,
  IonToast,
  IonModal,
  IonChip,
  IonIcon,
  IonItem,
  IonInput,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { documentOutline, eyeOutline, trashOutline } from 'ionicons/icons';
import { wsClient } from '../api/ws';
import { useAuth } from '../auth/AuthContext';
import { formatToman, formatKg, formatDate } from '../utils/format';
import { LocationPicker } from '../components/LocationPicker';

interface SaleRow {
  _id: string;
  invoiceNumber: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerLat?: number;
  customerLng?: number;
  customerId?: string;
  supplier?: string;
  totalAmount: number;
  totalKg?: number;
  totalProfit?: number;
  discount?: number;
  status?: string;
  isGolden?: boolean;
  paymentMethod?: string;
  priceTier?: string;
  date: string;
  items?: Array<{ productName: string; qtyKg: number; totalPrice: number; unit?: string; qtyInput?: number }>;
  notes?: string;
  shippingNotes?: string;
}

interface PurchaseRow {
  _id: string;
  invoiceNumber?: string;
  supplier?: string;
  totalAmount: number;
  totalKg?: number;
  paidNow?: boolean;
  date: string;
  notes?: string;
  items?: Array<{
    productName: string;
    qtyKg: number;
    totalPrice: number;
    unitPricePerKg?: number;
    kgPerPackage?: number;
  }>;
}

const STATUS: Record<string, string> = {
  pending: 'منتظر تأیید',
  approved: 'تأیید شده',
  shipped: 'ارسال شد',
  cancelled: 'لغو',
};

const PAY: Record<string, string> = {
  cash: 'نقد',
  card: 'پوز',
  card_to_card: 'کارت به کارت',
  credit: 'نسیه',
  mixed: 'ترکیبی',
};

const PAGE = 20;

const Invoices: React.FC = () => {
  const { isAdmin } = useAuth();
  const [mode, setMode] = useState<'sale' | 'purchase'>('sale');
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<SaleRow | PurchaseRow | null>(null);
  const [detailKind, setDetailKind] = useState<'sale' | 'purchase'>('sale');
  const [mapLat, setMapLat] = useState<number | null>(null);
  const [mapLng, setMapLng] = useState<number | null>(null);
  const [mapAddress, setMapAddress] = useState('');
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState('');
  const [deleting, setDeleting] = useState(false);

  const openSaleDetail = async (inv: SaleRow) => {
    setDetailKind('sale');
    setDetail(inv);
    setMapAddress(inv.customerAddress || '');
    setMapLat(inv.customerLat ?? null);
    setMapLng(inv.customerLng ?? null);

    // اگر روی فاکتور مختصات نبود، از پروفایل مشتری بگیر
    if ((inv.customerLat == null || inv.customerLng == null) && inv.customerId) {
      try {
        const res = await wsClient.request<{
          customer?: { address?: string; lat?: number; lng?: number };
        }>('customer.get', { id: inv.customerId });
        const c = res.customer;
        if (c) {
          if (c.lat != null) setMapLat(c.lat);
          if (c.lng != null) setMapLng(c.lng);
          if (!inv.customerAddress && c.address) setMapAddress(c.address);
        }
      } catch {
        /* ignore */
      }
    }
  };

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        wsClient.request<SaleRow[]>('sale.list', {}),
        isAdmin
          ? wsClient.request<PurchaseRow[]>('purchase.list', {})
          : Promise.resolve([] as PurchaseRow[]),
      ]);
      setSales(Array.isArray(s) ? s : []);
      setPurchases(Array.isArray(p) ? p : []);
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'خطا در لود فاکتورها',
        color: 'danger',
      });
    }
  }, [isAdmin]);

  useIonViewWillEnter(() => {
    void load();
    setPage(1);
  });

  const list = mode === 'sale' ? sales : purchases;
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const slice = list.slice((page - 1) * PAGE, page * PAGE);

  const openPdf = async (id: string) => {
    try {
      const res = await wsClient.request<{ html: string }>('sale.pdf', { id });
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(res.html);
        w.document.close();
      }
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'PDF ساخته نشد',
        color: 'danger',
      });
    }
  };

  const confirmDelete = async () => {
    if (!detail) return;
    setDeleting(true);
    try {
      if (detailKind === 'sale') {
        await wsClient.request('sale.delete', { id: detail._id, password: deletePw });
      } else {
        await wsClient.request('purchase.delete', { id: detail._id, password: deletePw });
      }
      setToast({ open: true, msg: 'فاکتور حذف شد', color: 'success' });
      setDeleteOpen(false);
      setDetail(null);
      setDeletePw('');
      await load();
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'حذف نشد',
        color: 'danger',
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>لیست فاکتورها</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e: CustomEvent<RefresherEventDetail>) => {
            await load();
            e.detail.complete();
          }}
        >
          <IonRefresherContent />
        </IonRefresher>

        <div className="ion-padding compact">
          <IonSegment
            value={mode}
            className="ios-segment"
            onIonChange={(e) => {
              setMode(e.detail.value as 'sale' | 'purchase');
              setPage(1);
            }}
          >
            <IonSegmentButton value="sale">
              <IonLabel>فروش ({sales.length})</IonLabel>
            </IonSegmentButton>
            {isAdmin && (
              <IonSegmentButton value="purchase">
                <IonLabel>خرید ({purchases.length})</IonLabel>
              </IonSegmentButton>
            )}
          </IonSegment>

          <div className="ios-glass-card" style={{ marginTop: 12 }}>
            {slice.length === 0 && <p className="hint">فاکتوری ثبت نشده</p>}

            {mode === 'sale' &&
              (slice as SaleRow[]).map((inv) => (
                <div key={inv._id} className="day-row inv-row">
                  <div className="ios-row">
                    <div>
                      <strong className={inv.isGolden ? 'gold-text' : ''}>
                        {inv.isGolden ? '⭐ ' : ''}
                        {inv.invoiceNumber}
                      </strong>
                      <div className="ios-caption">
                        {formatDate(inv.date)} · {inv.customerName || 'بدون مشتری'}
                        {inv.customerPhone ? ` · ${inv.customerPhone}` : ''}
                      </div>
                      {inv.customerAddress && (
                        <div className="ios-caption">📍 {inv.customerAddress}</div>
                      )}
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
                    <IonButton
                      size="small"
                      fill="clear"
                      onClick={() => void openSaleDetail(inv)}
                    >
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
                          setDetailKind('sale');
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

            {mode === 'purchase' &&
              (slice as PurchaseRow[]).map((inv) => (
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
                    <IonButton
                      size="small"
                      fill="clear"
                      onClick={() => {
                        setDetailKind('purchase');
                        setDetail(inv);
                      }}
                    >
                      <IonIcon slot="start" icon={eyeOutline} />
                      جزئیات
                    </IonButton>
                    {isAdmin && (
                      <IonButton
                        size="small"
                        fill="clear"
                        color="danger"
                        onClick={() => {
                          setDetailKind('purchase');
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

            {pages > 1 && (
              <div className="chip-row" style={{ justifyContent: 'center', marginTop: 12 }}>
                <IonButton size="small" fill="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  قبلی
                </IonButton>
                <span className="hint">
                  {page} / {pages}
                </span>
                <IonButton
                  size="small"
                  fill="outline"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  بعدی
                </IonButton>
              </div>
            )}
          </div>
        </div>

        <IonModal
          isOpen={!!detail}
          onDidDismiss={() => {
            setDetail(null);
            setMapLat(null);
            setMapLng(null);
            setMapAddress('');
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
            {detail && detailKind === 'sale' && (
              <>
                <p>
                  <b>شماره:</b> {(detail as SaleRow).invoiceNumber}
                </p>
                <p>
                  <b>مشتری:</b> {(detail as SaleRow).customerName || '—'}
                  {(detail as SaleRow).customerPhone ? ` · ${(detail as SaleRow).customerPhone}` : ''}
                </p>
                <p>
                  <b>تاریخ:</b> {formatDate(detail.date)}
                </p>
                <p>
                  <b>مبلغ:</b> {formatToman(detail.totalAmount)}
                </p>
                <p>
                  <b>تناژ:</b> {formatKg((detail as SaleRow).totalKg || 0)}
                </p>
                {(detail as SaleRow).totalProfit != null && (
                  <p>
                    <b>سود:</b> {formatToman((detail as SaleRow).totalProfit || 0)}
                  </p>
                )}
                {(detail as SaleRow).discount ? (
                  <p>
                    <b>تخفیف:</b> {formatToman((detail as SaleRow).discount || 0)}
                  </p>
                ) : null}
                <p>
                  <b>وضعیت:</b>{' '}
                  {STATUS[(detail as SaleRow).status || ''] || (detail as SaleRow).status || '—'}
                </p>
                <p>
                  <b>پرداخت:</b>{' '}
                  {PAY[(detail as SaleRow).paymentMethod || ''] || (detail as SaleRow).paymentMethod || '—'}
                </p>

                <div className="ios-glass-card">
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    آدرس و موقعیت
                  </div>
                  <p className="hint convert-hint" style={{ marginBottom: 8 }}>
                    📍 {mapAddress || (detail as SaleRow).customerAddress || 'آدرسی ثبت نشده'}
                  </p>
                  {mapLat != null && mapLng != null ? (
                    <LocationPicker
                      key={`${detail._id}-${mapLat}-${mapLng}`}
                      lat={mapLat}
                      lng={mapLng}
                      address={mapAddress || (detail as SaleRow).customerAddress}
                      readOnly
                      height={220}
                    />
                  ) : (
                    <p className="hint">مختصات روی نقشه ثبت نشده — فقط آدرس متنی موجود است</p>
                  )}
                </div>

                {(detail as SaleRow).shippingNotes && (
                  <p>
                    <b>ارسال:</b> {(detail as SaleRow).shippingNotes}
                  </p>
                )}
                {(detail as SaleRow).items?.length ? (
                  <div className="ios-glass-card">
                    <div className="ios-section-title" style={{ marginTop: 0 }}>
                      اقلام
                    </div>
                    {(detail as SaleRow).items!.map((it, i) => (
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
            {detail && detailKind === 'purchase' && (
              <>
                <p>
                  <b>شماره:</b> {(detail as PurchaseRow).invoiceNumber || '—'}
                </p>
                <p>
                  <b>تأمین‌کننده:</b> {(detail as PurchaseRow).supplier || '—'}
                </p>
                <p>
                  <b>تاریخ:</b> {formatDate(detail.date)}
                </p>
                <p>
                  <b>مبلغ:</b> {formatToman(detail.totalAmount)}
                </p>
                <p>
                  <b>تناژ:</b> {formatKg((detail as PurchaseRow).totalKg || 0)}
                </p>
                <p>
                  <b>پرداخت:</b> {(detail as PurchaseRow).paidNow ? 'نقد الان' : 'نسیه / بدهی شرکت'}
                </p>
                {(detail as PurchaseRow).items?.length ? (
                  <div className="ios-glass-card">
                    <div className="ios-section-title" style={{ marginTop: 0 }}>
                      اقلام
                    </div>
                    {(detail as PurchaseRow).items!.map((it, i) => (
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
            <p className="hint">رمز حذف را وارد کنید. موجودی و صندوق برمی‌گردند.</p>
            <IonItem>
              <IonLabel position="stacked">رمز حذف</IonLabel>
              <IonInput
                type="password"
                value={deletePw}
                onIonInput={(e) => setDeletePw(e.detail.value || '')}
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

        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2400}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default Invoices;
