import { useCallback, useEffect, useState } from 'react';
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
  IonSegment,
  IonSegmentButton,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonModal,
  IonButtons,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { checkmarkCircleOutline, cardOutline, trashOutline, eyeOutline, chevronBackOutline, chevronForwardOutline, createOutline } from 'ionicons/icons';
import { wsClient, newMutationId } from '../api/ws';
import { parseAmount, todayIso, formatToman, formatDate } from '../utils/format';
import { expenseTypes } from '../theme/colors';
import { PersianDateField } from '../components/PersianDateField';
import { MoneyInput } from '../components/MoneyInput';
import { useAuth } from '../auth/AuthContext';

interface ExpenseRow {
  _id: string;
  type: string;
  amount: number;
  description: string;
  date: string;
  notes?: string;
  paymentMethod?: 'cash' | 'card' | 'card_to_card';
  createdAt?: string;
}
interface DepositRow {
  _id: string;
  amount: number;
  description?: string;
  date: string;
  createdAt?: string;
  referenceId?: string;
}
interface CompanyRow {
  _id: string;
  supplier: string;
  amount: number;
  method: string;
  date: string;
  notes?: string;
  createdAt?: string;
}
interface CustomerHit {
  _id: string;
  name: string;
  phone?: string;
  totalCredit?: number;
}

type DetailItem =
  | { kind: 'expense'; row: ExpenseRow }
  | { kind: 'deposit'; row: DepositRow }
  | { kind: 'company'; row: CompanyRow };

const PAGE_SIZE = 12;

const Expense: React.FC = () => {
  const { isAdmin } = useAuth();
  const [mode, setMode] = useState<'expense' | 'deposit' | 'company'>('expense');
  const [type, setType] = useState('other');
  const [categoryId, setCategoryId] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [categories, setCategories] = useState<Array<{ _id: string; name: string; icon?: string; isBuiltin?: boolean }>>([]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayIso());
  const [depositAmount, setDepositAmount] = useState('');
  const [depositDesc, setDepositDesc] = useState('');
  const [depositCustomerId, setDepositCustomerId] = useState('');
  const [depositCustomerName, setDepositCustomerName] = useState('');
  const [custQuery, setCustQuery] = useState('');
  const [custHits, setCustHits] = useState<CustomerHit[]>([]);
  const [companyAmount, setCompanyAmount] = useState('');
  const [supplier, setSupplier] = useState('شرکت');
  const [method, setMethod] = useState<'cash' | 'card' | 'card_to_card'>('cash');
  const [companyPaidTotal, setCompanyPaidTotal] = useState(0);
  const [companyRemaining, setCompanyRemaining] = useState(0);
  const [expensePayMethod, setExpensePayMethod] = useState<'cash' | 'card_to_card'>('cash');
  const [editOpen, setEditOpen] = useState(false);
  const [editPw, setEditPw] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editDate, setEditDate] = useState(todayIso());
  const [editPayMethod, setEditPayMethod] = useState<'cash' | 'card_to_card'>('cash');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [deposits, setDeposits] = useState<DepositRow[]>([]);
  const [payments, setPayments] = useState<CompanyRow[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<DetailItem | null>(null);
  const [deletePw, setDeletePw] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadLists = useCallback(async (p = page) => {
    const [ex, dep, pay, cats, companySum] = await Promise.all([
      wsClient.request<{ items: ExpenseRow[]; total: number; pages: number; page: number }>(
        'expense.list',
        { page: p, pageSize: PAGE_SIZE }
      ),
      wsClient.request<{ items: DepositRow[]; total: number; pages: number; page: number }>(
        'cardDeposit.list',
        { page: p, pageSize: PAGE_SIZE }
      ),
      wsClient.request<CompanyRow[]>('companyPayment.list', {}),
      wsClient.request<Array<{ _id: string; name: string; icon?: string; isBuiltin?: boolean }>>(
        'expenseCategory.list',
        {}
      ),
      wsClient
        .request<{ totalPaidToCompany?: number; remainingDebt?: number }>('companyDebt.summary', {})
        .catch(() => ({ totalPaidToCompany: 0, remainingDebt: 0 })),
    ]);
    setExpenses(ex.items || []);
    setDeposits(dep.items || []);
    setPayments((pay || []).slice(0, PAGE_SIZE * p).slice(-PAGE_SIZE));
    setCategories(cats);
    setCompanyPaidTotal(companySum?.totalPaidToCompany || 0);
    setCompanyRemaining(companySum?.remainingDebt || 0);
    if (mode === 'expense') {
      setTotal(ex.total || 0);
      setPages(ex.pages || 1);
      setPage(ex.page || p);
    } else if (mode === 'deposit') {
      setTotal(dep.total || 0);
      setPages(dep.pages || 1);
      setPage(dep.page || p);
    } else {
      const all = pay || [];
      setTotal(all.length);
      setPages(Math.max(1, Math.ceil(all.length / PAGE_SIZE)));
      setPayments(all.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE));
      setPage(p);
    }
  }, [page, mode]);

  useIonViewWillEnter(() => {
    if (isAdmin) void loadLists(1).catch(console.warn);
  });

  useEffect(() => {
    if (!isAdmin) return;
    void loadLists(1).catch(console.warn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!isAdmin) return;
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === 'expense' || p?.entity === 'sale') {
        void loadLists(page).catch(console.warn);
      }
    });
    return unsub;
  }, [isAdmin, loadLists, page]);

  useEffect(() => {
    if (custQuery.trim().length < 2) {
      setCustHits([]);
      return;
    }
    const t = setTimeout(() => {
      void wsClient
        .request<{ customers: CustomerHit[] }>('customer.quick', { query: custQuery.trim() })
        .then((r) => setCustHits(r.customers || []))
        .catch(() => setCustHits([]));
    }, 280);
    return () => clearTimeout(t);
  }, [custQuery]);

  if (!isAdmin) {
    return (
      <IonPage>
        <IonHeader translucent className="ios-header">
          <IonToolbar>
            <IonTitle>هزینه</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <p className="empty-state">فقط مدیر دسترسی دارد</p>
        </IonContent>
      </IonPage>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setLoading(true);
    try {
      await fn();
      setToast({ open: true, msg: 'ثبت شد', color: 'success' });
      await loadLists(1);
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!detail) return;
    setLoading(true);
    try {
      if (detail.kind === 'expense') {
        await wsClient.request('expense.delete', { id: detail.row._id, password: deletePw });
      } else if (detail.kind === 'deposit') {
        await wsClient.request('cardDeposit.delete', { id: detail.row._id, password: deletePw });
      } else {
        await wsClient.request('companyPayment.delete', { id: detail.row._id, password: deletePw });
      }
      setToast({ open: true, msg: 'حذف شد', color: 'success' });
      setDeleteOpen(false);
      setDetail(null);
      setDeletePw('');
      await loadLists(page);
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'حذف نشد', color: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>هزینه / واریز / شرکت</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e: CustomEvent<RefresherEventDetail>) => {
            await loadLists(page);
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
              setMode(e.detail.value as typeof mode);
              setPage(1);
            }}
          >
            <IonSegmentButton value="expense">
              <IonLabel>هزینه</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="deposit">
              <IonLabel>واریز</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="company">
              <IonLabel>شرکت</IonLabel>
            </IonSegmentButton>
          </IonSegment>

          <PersianDateField value={date} onChange={setDate} />

          {mode === 'expense' && (
            <div className="ios-glass-card">
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                دسته هزینه
              </div>
              <div className="chip-row">
                {(categories.length ? categories : expenseTypes.map((t) => ({ _id: t.value, name: t.label, icon: t.value }))).map(
                  (c) => (
                    <IonChip
                      key={c._id}
                      className={
                        type === (c.icon || c.name) || categoryId === c._id ? 'ios-chip-active' : 'ios-chip'
                      }
                      onClick={() => {
                        setCategoryId(c._id);
                        setType(c.icon || c.name);
                      }}
                    >
                      {c.name}
                    </IonChip>
                  )
                )}
              </div>
              <IonItem>
                <IonLabel position="stacked">دسته جدید</IonLabel>
                <IonInput
                  value={newCatName}
                  placeholder="مثلاً بنزین، پذیرایی…"
                  onIonInput={(e) => setNewCatName(e.detail.value || '')}
                />
              </IonItem>
              <IonButton
                size="small"
                fill="outline"
                disabled={!newCatName.trim()}
                onClick={() =>
                  void run(async () => {
                    const created = await wsClient.request<{ _id: string; name: string; icon?: string }>(
                      'expenseCategory.create',
                      { name: newCatName.trim() }
                    );
                    setNewCatName('');
                    setCategoryId(created._id);
                    setType(created.name);
                    await loadLists(1);
                  })
                }
              >
                افزودن دسته
              </IonButton>
              <MoneyInput value={amount} onChange={(v) => setAmount(v)} />
              <div className="ios-section-title">نحوه پرداخت هزینه</div>
              <div className="chip-row">
                <IonChip
                  className={expensePayMethod === 'cash' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setExpensePayMethod('cash')}
                >
                  نقدی
                </IonChip>
                <IonChip
                  className={expensePayMethod === 'card_to_card' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setExpensePayMethod('card_to_card')}
                >
                  کارت به کارت
                </IonChip>
              </div>
              <p className="hint">حتماً مشخص کنید از صندوق نقد رفته یا کارت به کارت</p>
              <IonItem>
                <IonLabel position="stacked">توضیح</IonLabel>
                <IonInput value={description} onIonInput={(e) => setDescription(e.detail.value || '')} />
              </IonItem>
              <IonButton
                expand="block"
                className="ios-primary-btn"
                disabled={loading}
                onClick={() =>
                  void run(async () => {
                    const parsed = parseAmount(amount);
                    if (!parsed || !description.trim()) throw new Error('مبلغ و توضیح الزامی است');
                    if (!expensePayMethod) throw new Error('نحوه پرداخت را انتخاب کنید');
                    await wsClient.request(
                      'expense.create',
                      {
                        type,
                        categoryId: categoryId || undefined,
                        categoryName: type,
                        amount: parsed,
                        description,
                        date,
                        paymentMethod: expensePayMethod,
                      },
                      { clientMutationId: newMutationId(), queueIfOffline: true }
                    );
                    setAmount('');
                    setDescription('');
                  })
                }
              >
                <IonIcon slot="start" icon={checkmarkCircleOutline} />
                ثبت هزینه
              </IonButton>
            </div>
          )}

          {mode === 'deposit' && (
            <div className="ios-glass-card">
              <MoneyInput
                label="مبلغ واریز / کارت به کارت (تومان)"
                value={depositAmount}
                onChange={(v) => setDepositAmount(v)}
              />
              <IonItem>
                <IonLabel position="stacked">توضیح (اختیاری)</IonLabel>
                <IonInput value={depositDesc} onIonInput={(e) => setDepositDesc(e.detail.value || '')} />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">مشتری (اختیاری — برای کم کردن بدهی)</IonLabel>
                <IonInput
                  value={custQuery}
                  placeholder="جستجوی نام یا موبایل…"
                  onIonInput={(e) => {
                    setCustQuery(e.detail.value || '');
                    if (!e.detail.value) {
                      setDepositCustomerId('');
                      setDepositCustomerName('');
                    }
                  }}
                />
              </IonItem>
              {depositCustomerName && (
                <p className="hint convert-hint">انتخاب‌شده: {depositCustomerName}</p>
              )}
              {custHits.map((c) => (
                <div
                  key={c._id}
                  className="day-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setDepositCustomerId(c._id);
                    setDepositCustomerName(c.name);
                    setCustQuery(c.name);
                    setCustHits([]);
                  }}
                >
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : ''}
                  {c.totalCredit ? ` · بدهی ${formatToman(c.totalCredit)}` : ''}
                </div>
              ))}
              <IonButton
                expand="block"
                className="ios-primary-btn"
                disabled={loading}
                onClick={() =>
                  void run(async () => {
                    const parsed = parseAmount(depositAmount);
                    if (!parsed) throw new Error('مبلغ را وارد کنید');
                    const res = await wsClient.request<{ debtApplied?: number }>(
                      'cardDeposit.create',
                      {
                        amount: parsed,
                        date,
                        description: depositDesc || undefined,
                        customerId: depositCustomerId || undefined,
                        customerName: depositCustomerName || undefined,
                      },
                      { clientMutationId: newMutationId(), queueIfOffline: true }
                    );
                    setDepositAmount('');
                    setDepositDesc('');
                    setDepositCustomerId('');
                    setDepositCustomerName('');
                    setCustQuery('');
                    if (res?.debtApplied && res.debtApplied > 0) {
                      setToast({
                        open: true,
                        msg: `ثبت شد · ${formatToman(res.debtApplied)} از بدهی کم شد`,
                        color: 'success',
                      });
                    }
                  })
                }
              >
                <IonIcon slot="start" icon={cardOutline} />
                ثبت واریز
              </IonButton>
            </div>
          )}

          {mode === 'company' && (
            <div className="ios-glass-card">
              <div className="ios-kpi-grid" style={{ marginBottom: 10 }}>
                <div className="ios-kpi green">
                  <div className="k-label">پرداخت‌شده به شرکت</div>
                  <div className="k-value">{formatToman(companyPaidTotal)}</div>
                </div>
                <div className="ios-kpi rose">
                  <div className="k-label">مانده بدهی</div>
                  <div className="k-value">{formatToman(companyRemaining)}</div>
                </div>
              </div>
              <IonItem>
                <IonLabel position="stacked">نام شرکت</IonLabel>
                <IonInput value={supplier} onIonInput={(e) => setSupplier(e.detail.value || '')} />
              </IonItem>
              <MoneyInput
                label="مبلغ پرداخت (تومان)"
                value={companyAmount}
                onChange={(v) => setCompanyAmount(v)}
              />
              <div className="chip-row">
                <IonChip
                  className={method === 'cash' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setMethod('cash')}
                >
                  نقد
                </IonChip>
                <IonChip
                  className={method === 'card_to_card' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setMethod('card_to_card')}
                >
                  کارت به کارت
                </IonChip>
                <IonChip
                  className={method === 'card' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setMethod('card')}
                >
                  کارت / پوز
                </IonChip>
              </div>
              <IonButton
                expand="block"
                className="ios-primary-btn"
                disabled={loading}
                onClick={() =>
                  void run(async () => {
                    const parsed = parseAmount(companyAmount);
                    if (!parsed) throw new Error('مبلغ را وارد کنید');
                    await wsClient.request(
                      'companyPayment.create',
                      { supplier, amount: parsed, method, date },
                      { clientMutationId: newMutationId(), queueIfOffline: true }
                    );
                    setCompanyAmount('');
                  })
                }
              >
                ثبت پرداخت به شرکت
              </IonButton>
            </div>
          )}

          <div className="ios-section-title">
            {mode === 'expense' ? 'لیست هزینه‌ها' : mode === 'deposit' ? 'لیست واریزها' : 'پرداخت‌های شرکت'}
            {total > 0 ? ` · ${total}` : ''}
          </div>
          <div className="ios-glass-card">
            {mode === 'expense' &&
              (expenses.length === 0 ? (
                <p className="hint">هنوز هزینه‌ای نیست</p>
              ) : (
                expenses.map((e) => (
                  <div
                    key={e._id}
                    className="day-row tap"
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetail({ kind: 'expense', row: e })}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}
                  >
                    <span>
                      {formatDate(e.date)} · {e.description} · {formatToman(e.amount)}
                      {e.paymentMethod === 'card_to_card'
                        ? ' · کارت‌به‌کارت'
                        : e.paymentMethod === 'card'
                          ? ' · کارت'
                          : ' · نقد'}
                    </span>
                    <IonButton
                      size="small"
                      fill="clear"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setDetail({ kind: 'expense', row: e });
                      }}
                    >
                      <IonIcon icon={eyeOutline} />
                    </IonButton>
                  </div>
                ))
              ))}
            {mode === 'deposit' &&
              (deposits.length === 0 ? (
                <p className="hint">هنوز واریزی نیست</p>
              ) : (
                deposits.map((d) => (
                  <div key={d._id} className="day-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>
                      {formatDate(d.date)} · {d.description || 'واریز'} · {formatToman(d.amount)}
                    </span>
                    <IonButton size="small" fill="clear" onClick={() => setDetail({ kind: 'deposit', row: d })}>
                      <IonIcon icon={eyeOutline} />
                    </IonButton>
                  </div>
                ))
              ))}
            {mode === 'company' &&
              (payments.length === 0 ? (
                <p className="hint">هنوز پرداختی نیست</p>
              ) : (
                payments.map((p) => (
                  <div key={p._id} className="day-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>
                      {formatDate(p.date)} · {p.supplier} · {formatToman(p.amount)} ·{' '}
                      {p.method === 'cash'
                        ? 'نقد'
                        : p.method === 'card_to_card'
                          ? 'کارت‌به‌کارت'
                          : 'کارت'}
                    </span>
                    <IonButton size="small" fill="clear" onClick={() => setDetail({ kind: 'company', row: p })}>
                      <IonIcon icon={eyeOutline} />
                    </IonButton>
                  </div>
                ))
              ))}
            {pages > 1 && (
              <div className="chip-row" style={{ justifyContent: 'center', marginTop: 12 }}>
                <IonButton
                  size="small"
                  fill="outline"
                  disabled={page <= 1}
                  onClick={() => void loadLists(page - 1)}
                >
                  <IonIcon icon={chevronForwardOutline} />
                </IonButton>
                <span className="hint">
                  صفحه {page} از {pages}
                </span>
                <IonButton
                  size="small"
                  fill="outline"
                  disabled={page >= pages}
                  onClick={() => void loadLists(page + 1)}
                >
                  <IonIcon icon={chevronBackOutline} />
                </IonButton>
              </div>
            )}
          </div>
        </div>

        <IonModal isOpen={!!detail} onDidDismiss={() => setDetail(null)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>جزئیات</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setDetail(null)}>بستن</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {detail?.kind === 'expense' && (
              <>
                <p><b>نوع:</b> {detail.row.type}</p>
                <p><b>توضیح:</b> {detail.row.description}</p>
                <p><b>مبلغ:</b> {formatToman(detail.row.amount)}</p>
                <p><b>تاریخ:</b> {formatDate(detail.row.date)}</p>
                <p>
                  <b>پرداخت:</b>{' '}
                  {detail.row.paymentMethod === 'card_to_card'
                    ? 'کارت به کارت'
                    : detail.row.paymentMethod === 'card'
                      ? 'کارت'
                      : 'نقدی'}
                </p>
                {detail.row.notes && <p><b>یادداشت:</b> {detail.row.notes}</p>}
                <IonButton
                  expand="block"
                  color="warning"
                  fill="outline"
                  className="ion-margin-top"
                  onClick={() => {
                    setEditAmount(String(detail.row.amount));
                    setEditDesc(detail.row.description);
                    setEditDate(String(detail.row.date).slice(0, 10));
                    setEditPayMethod(
                      detail.row.paymentMethod === 'card_to_card' ? 'card_to_card' : 'cash'
                    );
                    setEditPw('');
                    setEditOpen(true);
                  }}
                >
                  <IonIcon slot="start" icon={createOutline} />
                  ویرایش با رمز
                </IonButton>
              </>
            )}
            {detail?.kind === 'deposit' && (
              <>
                <p><b>توضیح:</b> {detail.row.description || 'واریز'}</p>
                <p><b>مبلغ:</b> {formatToman(detail.row.amount)}</p>
                <p><b>تاریخ:</b> {formatDate(detail.row.date)}</p>
              </>
            )}
            {detail?.kind === 'company' && (
              <>
                <p><b>شرکت:</b> {detail.row.supplier}</p>
                <p><b>مبلغ:</b> {formatToman(detail.row.amount)}</p>
                <p><b>روش:</b> {detail.row.method === 'cash' ? 'نقد' : 'کارت'}</p>
                <p><b>تاریخ:</b> {formatDate(detail.row.date)}</p>
                {detail.row.notes && <p><b>یادداشت:</b> {detail.row.notes}</p>}
              </>
            )}
            <IonButton
              expand="block"
              color="danger"
              className="ion-margin-top"
              onClick={() => {
                setDeletePw('');
                setDeleteOpen(true);
              }}
            >
              <IonIcon slot="start" icon={trashOutline} />
              حذف (با رمز)
            </IonButton>
          </IonContent>
        </IonModal>

        <IonModal isOpen={editOpen} onDidDismiss={() => setEditOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>ویرایش هزینه</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setEditOpen(false)}>انصراف</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <MoneyInput label="مبلغ" value={editAmount} onChange={setEditAmount} />
            <IonItem>
              <IonLabel position="stacked">توضیح</IonLabel>
              <IonInput value={editDesc} onIonInput={(e) => setEditDesc(e.detail.value || '')} />
            </IonItem>
            <PersianDateField value={editDate} onChange={setEditDate} />
            <div className="chip-row">
              <IonChip
                className={editPayMethod === 'cash' ? 'ios-chip-active' : 'ios-chip'}
                onClick={() => setEditPayMethod('cash')}
              >
                نقدی
              </IonChip>
              <IonChip
                className={editPayMethod === 'card_to_card' ? 'ios-chip-active' : 'ios-chip'}
                onClick={() => setEditPayMethod('card_to_card')}
              >
                کارت به کارت
              </IonChip>
            </div>
            <IonItem>
              <IonLabel position="stacked">رمز ویرایش</IonLabel>
              <IonInput
                type="password"
                value={editPw}
                onIonInput={(e) => setEditPw(e.detail.value || '')}
              />
            </IonItem>
            <IonButton
              expand="block"
              color="warning"
              className="ion-margin-top"
              disabled={loading || !editPw}
              onClick={async () => {
                if (!detail || detail.kind !== 'expense') return;
                setLoading(true);
                try {
                  await wsClient.request('expense.update', {
                    id: detail.row._id,
                    password: editPw,
                    amount: parseAmount(editAmount),
                    description: editDesc,
                    date: editDate,
                    paymentMethod: editPayMethod,
                  });
                  setToast({ open: true, msg: 'ویرایش شد', color: 'success' });
                  setEditOpen(false);
                  setDetail(null);
                  await loadLists(page);
                } catch (e) {
                  setToast({
                    open: true,
                    msg: e instanceof Error ? e.message : 'خطا',
                    color: 'danger',
                  });
                } finally {
                  setLoading(false);
                }
              }}
            >
              ذخیره با رمز
            </IonButton>
          </IonContent>
        </IonModal>

        <IonModal isOpen={deleteOpen} onDidDismiss={() => setDeleteOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>تأیید حذف</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setDeleteOpen(false)}>انصراف</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <p className="hint">برای حذف، رمز مخصوص را وارد کنید.</p>
            <IonItem>
              <IonLabel position="stacked">رمز حذف</IonLabel>
              <IonInput
                type="password"
                value={deletePw}
                onIonInput={(e) => setDeletePw(e.detail.value || '')}
                placeholder="رمز…"
              />
            </IonItem>
            <IonButton expand="block" color="danger" disabled={loading || !deletePw} onClick={() => void confirmDelete()}>
              حذف قطعی
            </IonButton>
          </IonContent>
        </IonModal>

        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2600}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default Expense;
