import { useState } from 'react';
import { IonButton, IonIcon, IonToast } from '@ionic/react';
import { copyOutline } from 'ionicons/icons';
import { formatToman, formatKg, formatDateTime, normalizePhone } from '../utils/format';
import { wsClient } from '../api/ws';
import {
  buildInvoiceShareText,
  copyText,
  invoiceIsSettled,
  openSmsComposer,
  pickDefaultBankCard,
} from '../utils/invoiceShare';

export type SaleDetailItem = {
  productId?: string;
  productName: string;
  qtyKg: number;
  totalPrice: number;
  unit?: 'kg' | 'package' | string;
  qtyInput?: number;
  unitPrice?: number;
  unitPricePerKg?: number;
  discount?: number;
  kgPerPackage?: number;
  qtyPackages?: number;
};

export type PaymentEventRow = {
  amount: number;
  method?: 'cash' | 'card' | 'card_to_card' | string;
  date: string;
  kind?: 'invoice' | 'credit_settle' | string;
  note?: string;
};

export type SaleDetailInv = {
  invoiceNumber?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  totalAmount: number;
  totalKg?: number;
  totalProfit?: number;
  discount?: number;
  date?: string;
  status?: string;
  paymentMethod?: string;
  payment?: { cash?: number; card?: number; credit?: number };
  paymentEvents?: PaymentEventRow[];
  priceTier?: string;
  isGolden?: boolean;
  notes?: string;
  shippingNotes?: string;
  shippedAt?: string;
  deliveredAt?: string;
  paidAt?: string;
  lastPaymentAt?: string;
  isPaid?: boolean;
  items?: SaleDetailItem[];
};

const STATUS: Record<string, string> = {
  pending: 'منتظر تأیید',
  approved: 'تأیید شده / آماده ارسال',
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

export function summarizeSaleItems(items: SaleDetailItem[] = []) {
  const lineCount = items.length;
  const totalKg = items.reduce((s, it) => s + (it.qtyKg || 0), 0);
  const packageCount = items.reduce((s, it) => {
    if (it.qtyPackages != null) return s + (it.qtyPackages || 0);
    if (it.unit === 'package') return s + (it.qtyInput || 0);
    const kgPer = it.kgPerPackage || 0;
    if (kgPer > 0 && it.qtyKg > 0) return s + it.qtyKg / kgPer;
    return s;
  }, 0);
  return {
    lineCount,
    totalKg: Math.round(totalKg * 100) / 100,
    packageCount: Math.round(packageCount * 10) / 10,
  };
}

type Props = {
  inv: SaleDetailInv;
  showHeader?: boolean;
  onToast?: (msg: string, color?: string) => void;
};

async function invoiceShareText(inv: SaleDetailInv): Promise<string> {
  const shareItems = (inv.items || []).map((it) => ({
    productName: it.productName,
    qtyKg: it.qtyKg,
    qtyInput: it.qtyInput,
    unit: it.unit === 'package' ? ('package' as const) : ('kg' as const),
    unitPricePerKg: it.unitPricePerKg,
    totalPrice: it.totalPrice,
    discount: it.discount,
  }));
  const payload = {
    invoiceNumber: inv.invoiceNumber,
    customerName: inv.customerName,
    customerPhone: inv.customerPhone,
    date: inv.date,
    totalAmount: inv.totalAmount,
    totalKg: inv.totalKg,
    discount: inv.discount,
    paymentMethod: inv.paymentMethod,
    isGolden: inv.isGolden,
    items: shareItems,
    payment: inv.payment,
    isPaid: inv.isPaid,
  };
  const settled = invoiceIsSettled(inv);
  if (!settled) {
    try {
      const s = await wsClient.request<{
        shopName?: string;
        bankCards?: Array<{
          label: string;
          cardNumber: string;
          accountHolder?: string;
          bankName?: string;
          isDefault?: boolean;
        }>;
      }>('settings.get');
      const picked = pickDefaultBankCard(s.bankCards || []);
      const defaultCard = picked
        ? {
            label: picked.label,
            cardNumber: picked.cardNumber,
            accountHolder: picked.accountHolder,
            bankName: picked.bankName,
          }
        : undefined;
      return buildInvoiceShareText(
        { ...payload, shopName: s.shopName },
        defaultCard ? { defaultCard } : undefined
      );
    } catch {
      /* بدون تنظیمات */
    }
  }
  return buildInvoiceShareText(payload);
}

/** جزئیات غنی فاکتور فروش — تعداد اقلام، کیلو، بسته و خطوط */
export const SaleInvoiceDetailBody: React.FC<Props> = ({ inv, showHeader = true, onToast }) => {
  const items = inv.items || [];
  const sum = summarizeSaleItems(items);
  const kg = inv.totalKg != null ? inv.totalKg : sum.totalKg;
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const notify = (msg: string, color = 'success') => {
    onToast?.(msg, color);
    setToast({ open: true, msg, color });
  };

  const copyPhone = async () => {
    const phone = normalizePhone(inv.customerPhone) || inv.customerPhone || '';
    if (!phone) {
      notify('شماره‌ای ثبت نشده', 'warning');
      return;
    }
    const ok = await copyText(phone);
    notify(ok ? 'شماره کپی شد' : 'کپی نشد', ok ? 'success' : 'danger');
  };

  const smsWithInvoice = async () => {
    if (!inv.customerPhone) {
      notify('شماره‌ای ثبت نشده', 'warning');
      return;
    }
    const text = await invoiceShareText(inv);
    const copied = await copyText(text);
    const opened = openSmsComposer(inv.customerPhone, text);
    if (opened) {
      notify(copied ? 'متن فاکتور کپی شد — پیامک باز شد' : 'پیامک باز شد');
    } else {
      notify(copied ? 'متن فاکتور کپی شد' : 'کپی نشد', copied ? 'success' : 'danger');
    }
  };

  return (
    <>
      {showHeader && inv.invoiceNumber != null && (
        <p>
          <b>شماره:</b> {inv.invoiceNumber}
          {inv.isGolden ? ' ⭐ طلایی' : ''}
        </p>
      )}
      {showHeader && (inv.customerName || inv.customerPhone) && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ marginBottom: inv.customerPhone ? 6 : 0 }}>
            <b>مشتری:</b> {inv.customerName || '—'}
            {inv.customerPhone ? (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={() => void smsWithInvoice()}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--ion-color-primary)',
                    font: 'inherit',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  {inv.customerPhone}
                </button>
              </>
            ) : null}
          </p>
          {inv.customerPhone ? (
            <IonButton size="small" fill="outline" onClick={() => void copyPhone()}>
              <IonIcon slot="start" icon={copyOutline} />
              کپی شماره
            </IonButton>
          ) : null}
        </div>
      )}
      {inv.customerAddress ? (
        <p>
          <b>آدرس:</b> {inv.customerAddress}
        </p>
      ) : null}
      {inv.date ? (
        <p>
          <b>تاریخ فاکتور:</b> {formatDateTime(inv.date)}
        </p>
      ) : null}

      <div className="ios-glass-card" style={{ marginBottom: 12 }}>
        <div className="ios-section-title" style={{ marginTop: 0 }}>
          زمان‌بندی فاکتور
        </div>
        <div className="stat-row">
          <span>ثبت / فروش</span>
          <span>{inv.date ? formatDateTime(inv.date) : '—'}</span>
        </div>
        <div className="stat-row">
          <span>کی برده (ارسال)</span>
          <span>{inv.shippedAt ? formatDateTime(inv.shippedAt) : 'هنوز نبرده'}</span>
        </div>
        {inv.deliveredAt ? (
          <div className="stat-row">
            <span>تحویل</span>
            <span>{formatDateTime(inv.deliveredAt)}</span>
          </div>
        ) : null}
        <div className="stat-row">
          <span>آخرین پرداخت</span>
          <span>
            {inv.lastPaymentAt
              ? formatDateTime(inv.lastPaymentAt)
              : inv.paidAt
                ? formatDateTime(inv.paidAt)
                : 'پرداختی ثبت نشده'}
          </span>
        </div>
        <div className="stat-row">
          <span>کی تسویه شده</span>
          <span>
            {inv.isPaid === false
              ? 'هنوز کامل تسویه نشده'
              : inv.paidAt
                ? formatDateTime(inv.paidAt)
                : inv.payment && (inv.payment.credit || 0) <= 0
                  ? inv.date
                    ? formatDateTime(inv.date)
                    : 'تسویه'
                  : '—'}
          </span>
        </div>
      </div>

      <div className="ios-glass-card" style={{ marginBottom: 12 }}>
        <div className="ios-section-title" style={{ marginTop: 0 }}>
          خلاصه مقدار
        </div>
        <div className="stat-row">
          <span>تعداد اقلام</span>
          <span>{sum.lineCount.toLocaleString('fa-IR')}</span>
        </div>
        <div className="stat-row">
          <span>کل کیلوگرم</span>
          <span>{formatKg(kg)}</span>
        </div>
        {sum.packageCount > 0 && (
          <div className="stat-row">
            <span>تعداد بسته</span>
            <span>{sum.packageCount.toLocaleString('fa-IR')}</span>
          </div>
        )}
        <div className="stat-row">
          <span>مبلغ فاکتور</span>
          <span>{formatToman(inv.totalAmount)}</span>
        </div>
        {inv.totalProfit != null && (
          <div className="stat-row">
            <span>سود</span>
            <span>{formatToman(inv.totalProfit || 0)}</span>
          </div>
        )}
        {(inv.discount || 0) > 0 && (
          <div className="stat-row">
            <span>تخفیف</span>
            <span>{formatToman(inv.discount || 0)}</span>
          </div>
        )}
      </div>

      {inv.priceTier ? (
        <p>
          <b>سطح قیمت:</b> {TIER[inv.priceTier] || inv.priceTier}
        </p>
      ) : null}
      {inv.paymentMethod ? (
        <p>
          <b>روش پرداخت:</b> {PAY[inv.paymentMethod] || inv.paymentMethod}
        </p>
      ) : null}
      {inv.payment && (
        <div className="ios-glass-card">
          <div className="ios-section-title" style={{ marginTop: 0 }}>
            جزئیات پرداخت مشتری
          </div>
          <div className="stat-row">
            <span>نقد</span>
            <span>{formatToman(inv.payment.cash || 0)}</span>
          </div>
          <div className="stat-row">
            <span>پوز / کارت</span>
            <span>{formatToman(inv.payment.card || 0)}</span>
          </div>
          <div className="stat-row">
            <span>نسیه</span>
            <span className="warning">{formatToman(inv.payment.credit || 0)}</span>
          </div>
        </div>
      )}

      {(inv.paymentEvents || []).length > 0 && (
        <div className="ios-glass-card">
          <div className="ios-section-title" style={{ marginTop: 0 }}>
            کی پول داده
          </div>
          {(inv.paymentEvents || []).map((ev, i) => (
            <div key={`${ev.date}-${i}`} className="stat-row" style={{ alignItems: 'flex-start' }}>
              <span>
                {ev.kind === 'credit_settle' ? 'وصول نسیه' : 'پرداخت فاکتور'}
                {' · '}
                {PAY[ev.method || ''] || ev.method || '—'}
                {ev.note ? ` · ${ev.note}` : ''}
                <div className="ios-caption">{formatDateTime(ev.date)}</div>
              </span>
              <span>{formatToman(ev.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {inv.status ? (
        <p>
          <b>وضعیت:</b> {STATUS[inv.status] || inv.status}
        </p>
      ) : null}
      {inv.shippingNotes ? (
        <p>
          <b>ارسال:</b> {inv.shippingNotes}
        </p>
      ) : null}
      {inv.notes ? (
        <p>
          <b>یادداشت:</b> {inv.notes}
        </p>
      ) : null}

      {items.length > 0 && (
        <div className="ios-glass-card">
          <div className="ios-section-title" style={{ marginTop: 0 }}>
            اقلام ({sum.lineCount.toLocaleString('fa-IR')} قلم · {formatKg(sum.totalKg)})
          </div>
          {items.map((it, i) => {
            const perKg =
              it.unitPricePerKg || (it.qtyKg > 0 ? Math.round(it.totalPrice / it.qtyKg) : 0);
            const pkg =
              it.qtyPackages ??
              (it.unit === 'package' ? it.qtyInput : undefined) ??
              (it.kgPerPackage && it.qtyKg
                ? Math.round((it.qtyKg / it.kgPerPackage) * 10) / 10
                : undefined);
            return (
              <div key={i} style={{ marginBottom: 10 }}>
                <div className="stat-row">
                  <span>
                    <strong>
                      {i + 1}. {it.productName}
                    </strong>
                  </span>
                  <span>{formatToman(it.totalPrice)}</span>
                </div>
                <div className="ios-caption">
                  {formatKg(it.qtyKg)}
                  {pkg != null && pkg > 0 ? ` · ${Number(pkg).toLocaleString('fa-IR')} بسته` : ''}
                  {it.unit === 'kg' ? ' · واحد کیلو' : it.unit === 'package' ? ' · واحد بسته' : ''}
                  {' · '}
                  فی {formatToman(perKg)}/کیلو
                  {it.unitPrice && it.unit === 'package'
                    ? ` · فی بسته ${formatToman(it.unitPrice)}`
                    : ''}
                  {it.discount ? ` · تخفیف ${formatToman(it.discount)}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <IonToast
        isOpen={toast.open}
        message={toast.msg}
        color={toast.color}
        duration={1800}
        onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
      />
    </>
  );
};

export default SaleInvoiceDetailBody;
