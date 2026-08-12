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
  IonChip,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  IonModal,
  IonButtons,
  IonSearchbar,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { wsClient, newMutationId } from '../api/ws';
import {
  formatToman,
  formatKg,
  formatDate,
  parseAmount,
  formatMoneyInput,
} from '../utils/format';
import { PersianDateField } from '../components/PersianDateField';
import { useAuth } from '../auth/AuthContext';
import { InvoiceListPanel, SaleInvRow } from '../components/InvoiceListPanel';
import { SaleInvoiceDetailBody } from '../components/SaleInvoiceDetailBody';
import { buildInvoiceShareText, copyText } from '../utils/invoiceShare';
import { MoneyInput } from '../components/MoneyInput';

interface DebtRow {
  _id: string;
  name: string;
  phone?: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  dueDate: string;
  description?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  saleInvoiceId?: string;
  invoiceNumber?: string;
  invoiceTotal?: number;
  invoiceKg?: number;
  invoiceDate?: string;
  invoiceStatus?: string;
  invoiceShippedAt?: string;
  invoicePaidAt?: string;
  invoiceLastPaymentAt?: string;
  invoiceIsPaid?: boolean;
  invoiceItems?: Array<{
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
}

interface CustomerDebtGroup {
  key: string;
  customerId?: string;
  name: string;
  phone?: string;
  address?: string;
  totalRemaining: number;
  totalAmount: number;
  totalPaid: number;
  overdueRemaining: number;
  invoiceCount: number;
  overdueCount: number;
  nearestDue: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskLabel: string;
  debts: DebtRow[];
}

function groupKey(d: DebtRow) {
  if (d.customerId) return `c:${d.customerId}`;
  return `n:${(d.customerName || d.name || '').trim()}|${(d.customerPhone || d.phone || '').trim()}`;
}

function riskOf(open: number, overdue: number): { riskLevel: CustomerDebtGroup['riskLevel']; riskLabel: string } {
  const ratio = open > 0 ? overdue / open : 0;
  if (overdue > 0 && ratio >= 0.5) return { riskLevel: 'critical', riskLabel: 'ریسک خیلی بالا' };
  if (overdue > 0 || ratio >= 0.35) return { riskLevel: 'high', riskLabel: 'ریسک بالا' };
  if (open > 0) return { riskLevel: 'medium', riskLabel: 'ریسک متوسط' };
  return { riskLevel: 'low', riskLabel: 'ریسک کم' };
}

const Debtors: React.FC = () => {
  const history = useHistory();
  const { isAdmin } = useAuth();
  const [debtors, setDebtors] = useState<DebtRow[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CustomerDebtGroup | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'card' | 'card_to_card'>('cash');
  const [linePay, setLinePay] = useState<Record<string, string>>({});
  const [lineMethod, setLineMethod] = useState<Record<string, 'cash' | 'card' | 'card_to_card'>>({});
  const [editDebt, setEditDebt] = useState<DebtRow | null>(null);
  const [editDue, setEditDue] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [debtDetail, setDebtDetail] = useState<DebtRow | null>(null);
  const [debtSaleDetail, setDebtSaleDetail] = useState<SaleInvRow | null>(null);
  const [seedEdit, setSeedEdit] = useState<SaleInvRow | null>(null);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const load = useCallback(async () => {
    const list = await wsClient.request<DebtRow[]>('debtor.list', { settled: false });
    setDebtors(Array.isArray(list) ? list : []);
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  const groups = useMemo(() => {
    const map = new Map<string, CustomerDebtGroup>();
    const now = Date.now();
    for (const d of debtors) {
      const rem = d.remaining ?? Math.max(0, d.amount - (d.paidAmount || 0));
      if (rem <= 0) continue;
      const key = groupKey(d);
      const overdue = new Date(d.dueDate).getTime() < now;
      const prev = map.get(key);
      if (!prev) {
        const risk = riskOf(rem, overdue ? rem : 0);
        map.set(key, {
          key,
          customerId: d.customerId,
          name: d.customerName || d.name,
          phone: d.customerPhone || d.phone,
          address: d.customerAddress,
          totalRemaining: rem,
          totalAmount: d.amount,
          totalPaid: d.paidAmount || 0,
          overdueRemaining: overdue ? rem : 0,
          invoiceCount: 1,
          overdueCount: overdue ? 1 : 0,
          nearestDue: d.dueDate,
          riskLevel: risk.riskLevel,
          riskLabel: risk.riskLabel,
          debts: [d],
        });
      } else {
        prev.totalRemaining += rem;
        prev.totalAmount += d.amount;
        prev.totalPaid += d.paidAmount || 0;
        prev.invoiceCount += 1;
        if (overdue) {
          prev.overdueCount += 1;
          prev.overdueRemaining += rem;
        }
        if (new Date(d.dueDate) < new Date(prev.nearestDue)) prev.nearestDue = d.dueDate;
        prev.debts.push(d);
        if (!prev.phone && (d.customerPhone || d.phone)) prev.phone = d.customerPhone || d.phone;
        if (!prev.customerId && d.customerId) prev.customerId = d.customerId;
        const risk = riskOf(prev.totalRemaining, prev.overdueRemaining);
        prev.riskLevel = risk.riskLevel;
        prev.riskLabel = risk.riskLabel;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalRemaining - a.totalRemaining);
  }, [debtors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.phone || '').includes(q) ||
        (g.address || '').toLowerCase().includes(q)
    );
  }, [groups, search]);

  const openGroup = (g: CustomerDebtGroup) => {
    setSelected(g);
    setPayAmount('');
    setPayMethod('cash');
    setLinePay({});
    setLineMethod({});
  };

  const goNewInvoice = (g: CustomerDebtGroup) => {
    if (g.customerId) {
      history.push('/sale', { followUpCustomerId: g.customerId });
      return;
    }
    history.push('/sale');
    setToast({
      open: true,
      msg: 'مشتری را در فروش انتخاب کنید (شناسه مشتری ثبت نشده)',
      color: 'warning',
    });
  };

  const openDebtDetail = async (d: DebtRow) => {
    setDebtDetail(d);
    setDebtSaleDetail(null);
    if (!d.saleInvoiceId) return;
    try {
      const inv = await wsClient.request<SaleInvRow>('sale.get', { id: d.saleInvoiceId });
      setDebtSaleDetail({
        ...inv,
        _id: String(inv._id),
        items: (inv.items || []).map((it) => ({
          ...it,
          productId: it.productId ? String(it.productId) : undefined,
        })),
      });
    } catch {
      /* keep debtDetail only */
    }
  };

  const copyDebtReport = async (d: DebtRow, inv?: SaleInvRow | null) => {
    const rem = d.remaining ?? Math.max(0, d.amount - (d.paidAmount || 0));
    const total = inv?.totalAmount ?? d.invoiceTotal ?? d.amount;
    const paid = inv
      ? Math.round(inv.payment?.cash || 0) + Math.round(inv.payment?.card || 0)
      : Math.round(d.paidAmount || 0);
    const credit = inv ? Math.round(inv.payment?.credit || 0) : rem;
    const text = buildInvoiceShareText({
      invoiceNumber: d.invoiceNumber || inv?.invoiceNumber,
      customerName: d.customerName || d.name || inv?.customerName,
      customerPhone: d.customerPhone || d.phone || inv?.customerPhone,
      date: d.invoiceDate || inv?.date,
      totalAmount: total,
      totalKg: d.invoiceKg ?? inv?.totalKg,
      paymentMethod: inv?.paymentMethod || (credit > 0 ? 'credit' : 'mixed'),
      items: inv?.items || d.invoiceItems,
      payment: inv?.payment || {
        cash: paid > 0 ? paid : 0,
        card: 0,
        credit,
      },
      isPaid: rem <= 0 || inv?.isPaid,
    });
    const ok = await copyText(text);
    setToast({
      open: true,
      msg: ok
        ? `کپی شد — فاکتور ${formatToman(total)} · پرداخت ${formatToman(paid)} · مانده ${formatToman(credit || rem)}`
        : 'کپی نشد',
      color: ok ? 'success' : 'danger',
    });
  };

  const openInvoiceEdit = async (saleInvoiceId?: string) => {
    if (!saleInvoiceId) {
      setToast({ open: true, msg: 'فاکتور مرتبط پیدا نشد', color: 'warning' });
      return;
    }
    try {
      const inv = await wsClient.request<SaleInvRow>('sale.get', { id: saleInvoiceId });
      setDebtDetail(null);
      setDebtSaleDetail(null);
      setSeedEdit({
        ...inv,
        _id: String(inv._id),
        items: (inv.items || []).map((it) => ({
          ...it,
          productId: it.productId ? String(it.productId) : undefined,
        })),
      });
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'فاکتور لود نشد',
        color: 'danger',
      });
    }
  };

  const active = useMemo(() => {
    if (!selected) return null;
    return groups.find((g) => g.key === selected.key) || null;
  }, [groups, selected]);

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>نسیه — بدهکاران</IonTitle>
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

        <div className="ion-padding debtors-page">
          <div className="debtors-hero">
            <div className="debtors-hero-main">
              <div className="debtors-hero-label">جمع بدهی باز</div>
              <div className="debtors-hero-value">
                {formatToman(groups.reduce((s, g) => s + g.totalRemaining, 0))}
              </div>
            </div>
            <div className="debtors-hero-side">
              <div className="debtors-pill">
                <span>{groups.length.toLocaleString('fa-IR')}</span>
                <small>مشتری</small>
              </div>
              <div className="debtors-pill warn">
                <span>
                  {groups.reduce((s, g) => s + g.overdueCount, 0).toLocaleString('fa-IR')}
                </span>
                <small>معوق</small>
              </div>
            </div>
          </div>

          <IonSearchbar
            value={search}
            placeholder="جستجوی مشتری…"
            className="ios-search"
            onIonInput={(e) => setSearch(e.detail.value || '')}
          />

          {filtered.length === 0 && <p className="hint">بدهکار فعالی نیست</p>}

          {filtered.map((g) => (
            <div
              key={g.key}
              className={`debtor-card tap${active?.key === g.key ? ' selected' : ''}${
                g.overdueCount > 0 ? ' overdue' : ''
              }`}
              onClick={() => openGroup(g)}
              role="button"
              tabIndex={0}
            >
              <div className="debtor-card-top">
                <div>
                  <div className="debtor-name">
                    {g.overdueCount > 0 && <span className="debtor-badge">معوق</span>}
                    {g.name}
                  </div>
                  <div className="ios-caption">
                    {g.phone || 'بدون تلفن'}
                    {g.invoiceCount > 1
                      ? ` · ${g.invoiceCount.toLocaleString('fa-IR')} فاکتور`
                      : ' · ۱ فاکتور'}
                  </div>
                  <div className="ios-caption">سررسید نزدیک: {formatDate(g.nearestDue)}</div>
                  <div className="ios-caption" style={{ color: g.overdueCount > 0 ? 'var(--ion-color-danger)' : undefined }}>
                    {g.riskLabel}
                    {g.overdueRemaining > 0
                      ? ` · معوقه ${formatToman(g.overdueRemaining)}`
                      : ''}
                  </div>
                </div>
                <div className="debtor-amount">
                  <div className="debtor-money">{formatToman(g.totalRemaining)}</div>
                  {(g.totalPaid || 0) > 0 && (
                    <div className="ios-caption">پرداختی {formatToman(g.totalPaid)}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <IonModal
          isOpen={!!active}
          onDidDismiss={() => {
            setSelected(null);
            setEditDebt(null);
          }}
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>{active?.name || 'بدهی مشتری'}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setSelected(null)}>بستن</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {active && (
              <>
                <div className="ios-kpi-grid">
                  <div className="ios-kpi rose">
                    <div className="k-label">کل بدهی مشتری</div>
                    <div className="k-value">{formatToman(active.totalRemaining)}</div>
                  </div>
                  <div className="ios-kpi">
                    <div className="k-label">تعداد فاکتور</div>
                    <div className="k-value">{active.invoiceCount}</div>
                  </div>
                  <div className="ios-kpi orange">
                    <div className="k-label">ریسک فروش</div>
                    <div className="k-value" style={{ fontSize: 14 }}>
                      {active.riskLabel}
                    </div>
                  </div>
                  <div className="ios-kpi">
                    <div className="k-label">معوقه</div>
                    <div className="k-value">{formatToman(active.overdueRemaining)}</div>
                  </div>
                </div>
                <p className="hint">
                  {active.phone || 'بدون تلفن'}
                  {active.address ? ` · ${active.address}` : ''}
                </p>

                <div className="chip-row">
                  <IonButton size="small" onClick={() => goNewInvoice(active)}>
                    فاکتور جدید
                  </IonButton>
                  <IonButton
                    size="small"
                    fill="outline"
                    routerLink="/customers"
                    onClick={() => setSelected(null)}
                  >
                    صفحه مشتری
                  </IonButton>
                </div>

                <div className="ios-section-title">دریافت روی کل بدهی</div>
                <div className="ios-glass-card">
                  <p className="hint">از قدیمی‌ترین فاکتور شروع می‌شود و کم می‌کند</p>
                  <div className="chip-row">
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
                  <IonItem>
                    <IonLabel position="stacked">مبلغ (تومان)</IonLabel>
                    <IonInput
                      inputMode="numeric"
                      value={payAmount}
                      onIonInput={(e) => setPayAmount(formatMoneyInput(e.detail.value || ''))}
                    />
                  </IonItem>
                  <IonButton
                    expand="block"
                    className="ios-primary-btn"
                    disabled={!payAmount}
                    onClick={async () => {
                      const amount = parseAmount(payAmount);
                      if (!amount) return;
                      try {
                        const res = await wsClient.request<{ applied: number }>(
                          'debtor.payCustomer',
                          {
                            customerId: active.customerId,
                            name: active.customerId ? undefined : active.name,
                            phone: active.customerId ? undefined : active.phone,
                            amount,
                            method: payMethod,
                          },
                          { clientMutationId: newMutationId(), queueIfOffline: true }
                        );
                        setPayAmount('');
                        setToast({
                          open: true,
                          msg: `${formatToman(res.applied)} از بدهی کم شد`,
                          color: 'success',
                        });
                        await load();
                      } catch (e) {
                        setToast({
                          open: true,
                          msg: e instanceof Error ? e.message : 'خطا',
                          color: 'danger',
                        });
                      }
                    }}
                  >
                    ثبت دریافت کلی
                  </IonButton>
                </div>

                <div className="ios-section-title">فاکتورهای بدهی</div>
                {active.debts.map((d) => {
                  const rem = d.remaining ?? Math.max(0, d.amount - (d.paidAmount || 0));
                  const overdue = new Date(d.dueDate) < new Date();
                  const method = lineMethod[d._id] || 'cash';
                  return (
                    <div key={d._id} className="ios-glass-card" style={{ marginTop: 10 }}>
                      <div className="ios-row">
                        <div>
                          <strong>
                            {overdue ? '⚠ ' : ''}
                            {d.invoiceNumber || 'بدون شماره فاکتور'}
                          </strong>
                          <div className="ios-caption">
                            سررسید {formatDate(d.dueDate)}
                            {d.invoiceDate ? ` · فاکتور ${formatDate(d.invoiceDate)}` : ''}
                            {d.invoiceKg ? ` · ${formatKg(d.invoiceKg)}` : ''}
                          </div>
                        </div>
                        <div className="inv-card-amount">
                          <div className="stat-value danger">{formatToman(rem)}</div>
                          <div className="ios-caption">
                            از {formatToman(d.amount)}
                            {(d.paidAmount || 0) > 0 ? ` · پرداختی ${formatToman(d.paidAmount)}` : ''}
                          </div>
                        </div>
                      </div>

                      {(d.invoiceItems || []).length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          {(d.invoiceItems || []).map((it, i) => {
                            const perKg =
                              it.unitPricePerKg ||
                              (it.qtyKg > 0 ? Math.round(it.totalPrice / it.qtyKg) : 0);
                            return (
                              <div key={i} className="ios-caption" style={{ marginTop: 2 }}>
                                {it.productName} · {formatKg(it.qtyKg)} · فی{' '}
                                {formatToman(perKg)}/کیلو · {formatToman(it.totalPrice)}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {d.description && <p className="hint">{d.description}</p>}

                      <div className="chip-row" style={{ marginTop: 8 }}>
                        <IonButton size="small" fill="outline" onClick={() => void openDebtDetail(d)}>
                          جزئیات
                        </IonButton>
                        <IonButton
                          size="small"
                          fill="clear"
                          onClick={() => void copyDebtReport(d)}
                        >
                          کپی گزارش
                        </IonButton>
                        {isAdmin && (
                          <IonButton
                            size="small"
                            fill="outline"
                            color="warning"
                            onClick={() => void openInvoiceEdit(d.saleInvoiceId)}
                          >
                            ویرایش فاکتور
                          </IonButton>
                        )}
                        {isAdmin && (
                          <IonButton
                            size="small"
                            fill="clear"
                            color="warning"
                            onClick={() => {
                              setEditDebt(d);
                              setEditDue(d.dueDate ? String(d.dueDate).slice(0, 10) : '');
                              setEditDesc(d.description || '');
                            }}
                          >
                            ویرایش سررسید
                          </IonButton>
                        )}
                      </div>

                      <div className="chip-row">
                        <IonChip
                          className={method === 'cash' ? 'ios-chip-active' : 'ios-chip'}
                          onClick={() => setLineMethod({ ...lineMethod, [d._id]: 'cash' })}
                        >
                          نقد
                        </IonChip>
                        <IonChip
                          className={method === 'card' ? 'ios-chip-active' : 'ios-chip'}
                          onClick={() => setLineMethod({ ...lineMethod, [d._id]: 'card' })}
                        >
                          پوز
                        </IonChip>
                        <IonChip
                          className={method === 'card_to_card' ? 'ios-chip-active' : 'ios-chip'}
                          onClick={() =>
                            setLineMethod({ ...lineMethod, [d._id]: 'card_to_card' })
                          }
                        >
                          کارت به کارت
                        </IonChip>
                      </div>
                      <IonItem>
                        <IonLabel position="stacked">دریافت این فاکتور (تومان)</IonLabel>
                        <IonInput
                          inputMode="numeric"
                          value={linePay[d._id] || ''}
                          onIonInput={(e) =>
                            setLinePay({
                              ...linePay,
                              [d._id]: formatMoneyInput(e.detail.value || ''),
                            })
                          }
                        />
                      </IonItem>
                      <IonButton
                        expand="block"
                        size="small"
                        onClick={async () => {
                          const amount = parseAmount(linePay[d._id] || '');
                          if (!amount) {
                            setToast({ open: true, msg: 'مبلغ را وارد کنید', color: 'danger' });
                            return;
                          }
                          try {
                            await wsClient.request(
                              'debtor.pay',
                              { id: d._id, amount, method },
                              { clientMutationId: newMutationId(), queueIfOffline: true }
                            );
                            setLinePay({ ...linePay, [d._id]: '' });
                            setToast({ open: true, msg: 'ثبت شد', color: 'success' });
                            await load();
                          } catch (e) {
                            setToast({
                              open: true,
                              msg: e instanceof Error ? e.message : 'خطا',
                              color: 'danger',
                            });
                          }
                        }}
                      >
                        ثبت دریافت این فاکتور
                      </IonButton>
                    </div>
                  );
                })}
              </>
            )}
          </IonContent>
        </IonModal>

        <IonModal isOpen={!!editDebt} onDidDismiss={() => setEditDebt(null)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>ویرایش بدهی</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setEditDebt(null)}>انصراف</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {editDebt && (
              <>
                <p className="hint">{editDebt.invoiceNumber || editDebt.name}</p>
                <PersianDateField label="سررسید" value={editDue} onChange={setEditDue} />
                <IonItem>
                  <IonLabel position="stacked">توضیح</IonLabel>
                  <IonInput
                    value={editDesc}
                    onIonInput={(e) => setEditDesc(e.detail.value || '')}
                  />
                </IonItem>
                <IonButton
                  expand="block"
                  className="ios-primary-btn ion-margin-top"
                  onClick={async () => {
                    try {
                      await wsClient.request('debtor.update', {
                        id: editDebt._id,
                        dueDate: editDue || undefined,
                        description: editDesc,
                      });
                      setToast({ open: true, msg: 'سررسید در بدهکاران و نسیه ذخیره شد', color: 'success' });
                      setEditDebt(null);
                      await load();
                    } catch (e) {
                      setToast({
                        open: true,
                        msg: e instanceof Error ? e.message : 'خطا',
                        color: 'danger',
                      });
                    }
                  }}
                >
                  ذخیره
                </IonButton>
              </>
            )}
          </IonContent>
        </IonModal>

        <IonModal
          isOpen={!!debtDetail}
          onDidDismiss={() => {
            setDebtDetail(null);
            setDebtSaleDetail(null);
          }}
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>جزئیات فاکتور بدهی</IonTitle>
              <IonButtons slot="end">
                <IonButton
                  onClick={() => {
                    setDebtDetail(null);
                    setDebtSaleDetail(null);
                  }}
                >
                  بستن
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {debtDetail && (
              <>
                <div className="ios-glass-card" style={{ marginBottom: 12 }}>
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    مانده نسیه این فاکتور
                  </div>
                  <div className="stat-row">
                    <span>بدهی اولیه</span>
                    <span>{formatToman(debtDetail.amount)}</span>
                  </div>
                  <div className="stat-row">
                    <span>پرداختی</span>
                    <span>{formatToman(debtDetail.paidAmount || 0)}</span>
                  </div>
                  <div className="stat-row">
                    <span>مانده</span>
                    <span className="warning">
                      {formatToman(
                        debtDetail.remaining ??
                          Math.max(0, debtDetail.amount - (debtDetail.paidAmount || 0))
                      )}
                    </span>
                  </div>
                  <div className="stat-row">
                    <span>سررسید</span>
                    <span>{formatDate(debtDetail.dueDate)}</span>
                  </div>
                </div>
                {debtSaleDetail ? (
                  <SaleInvoiceDetailBody
                    inv={debtSaleDetail}
                    onToast={(msg, color) => setToast({ open: true, msg, color: color || 'success' })}
                  />
                ) : (
                  <>
                    <p>
                      <b>شماره:</b> {debtDetail.invoiceNumber || '—'}
                    </p>
                    <p>
                      <b>تاریخ فاکتور:</b>{' '}
                      {debtDetail.invoiceDate ? formatDate(debtDetail.invoiceDate) : '—'}
                    </p>
                    {(debtDetail.invoiceItems || []).length > 0 && (
                      <div className="ios-glass-card">
                        <div className="ios-section-title" style={{ marginTop: 0 }}>
                          اقلام ({(debtDetail.invoiceItems || []).length.toLocaleString('fa-IR')} قلم
                          {debtDetail.invoiceKg != null
                            ? ` · ${formatKg(debtDetail.invoiceKg)}`
                            : ''}
                          )
                        </div>
                        {(debtDetail.invoiceItems || []).map((it, i) => {
                          const perKg =
                            it.unitPricePerKg ||
                            (it.qtyKg > 0 ? Math.round(it.totalPrice / it.qtyKg) : 0);
                          return (
                            <div key={i} className="ios-caption" style={{ marginTop: 4 }}>
                              {i + 1}. {it.productName} · {formatKg(it.qtyKg)} · فی{' '}
                              {formatToman(perKg)}/کیلو · {formatToman(it.totalPrice)}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
                {isAdmin && debtDetail.saleInvoiceId && (
                  <IonButton
                    expand="block"
                    color="warning"
                    className="ion-margin-top"
                    onClick={() => void openInvoiceEdit(debtDetail.saleInvoiceId)}
                  >
                    ویرایش فاکتور
                  </IonButton>
                )}
                <IonButton
                  expand="block"
                  fill="outline"
                  className="ion-margin-top"
                  onClick={() => void copyDebtReport(debtDetail, debtSaleDetail)}
                >
                  کپی گزارش (فاکتور / پرداخت / مانده)
                </IonButton>
              </>
            )}
          </IonContent>
        </IonModal>

        {seedEdit && (
          <InvoiceListPanel
            kind="sale"
            editOnly
            seedEdit={seedEdit}
            onSeedEditDone={() => {
              setSeedEdit(null);
              void load();
            }}
            onToast={(msg, color) => setToast({ open: true, msg, color: color || 'success' })}
          />
        )}

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

export default Debtors;
