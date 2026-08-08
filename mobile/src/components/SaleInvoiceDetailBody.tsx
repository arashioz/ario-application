import { formatToman, formatKg, formatDate } from '../utils/format';

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
  priceTier?: string;
  isGolden?: boolean;
  notes?: string;
  shippingNotes?: string;
  shippedAt?: string;
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
};

/** جزئیات غنی فاکتور فروش — تعداد اقلام، کیلو، بسته و خطوط */
export const SaleInvoiceDetailBody: React.FC<Props> = ({ inv, showHeader = true }) => {
  const items = inv.items || [];
  const sum = summarizeSaleItems(items);
  const kg = inv.totalKg != null ? inv.totalKg : sum.totalKg;

  return (
    <>
      {showHeader && inv.invoiceNumber != null && (
        <p>
          <b>شماره:</b> {inv.invoiceNumber}
          {inv.isGolden ? ' ⭐ طلایی' : ''}
        </p>
      )}
      {showHeader && (inv.customerName || inv.customerPhone) && (
        <p>
          <b>مشتری:</b> {inv.customerName || '—'}
          {inv.customerPhone ? ` · ${inv.customerPhone}` : ''}
        </p>
      )}
      {inv.customerAddress ? (
        <p>
          <b>آدرس:</b> {inv.customerAddress}
        </p>
      ) : null}
      {inv.date ? (
        <p>
          <b>تاریخ:</b> {formatDate(inv.date)}
        </p>
      ) : null}

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

      {inv.status ? (
        <p>
          <b>وضعیت:</b> {STATUS[inv.status] || inv.status}
        </p>
      ) : null}
      {inv.shippedAt ? (
        <p>
          <b>ارسال شده:</b> {formatDate(inv.shippedAt)}
        </p>
      ) : null}
      {inv.paidAt || inv.lastPaymentAt ? (
        <p>
          <b>پرداخت شده:</b> {formatDate(inv.paidAt || inv.lastPaymentAt!)}
          {inv.isPaid === false ? ' (جزئی)' : ''}
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
    </>
  );
};

export default SaleInvoiceDetailBody;
