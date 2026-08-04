import { useCallback, useState } from 'react';
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
  IonToast,
  IonSegment,
  IonSegmentButton,
  IonBadge,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { wsClient, newMutationId } from '../api/ws';
import { parseAmount, todayIso, formatToman, formatDate } from '../utils/format';
import { MoneyInput } from '../components/MoneyInput';
import { DigitInput } from '../components/DigitInput';
import { PersianDateField } from '../components/PersianDateField';

interface CheckRow {
  _id: string;
  payerName: string;
  invoiceNumber?: string;
  amount: number;
  checkNumber?: string;
  bankName?: string;
  dueDate: string;
  followUpDate: string;
  notes?: string;
  status: string;
}

const STATUS: Record<string, string> = {
  pending: 'در انتظار',
  collected: 'وصول شد',
  bounced: 'برگشت',
  cancelled: 'لغو',
};

const Checks: React.FC = () => {
  const [tab, setTab] = useState<'pending' | 'all' | 'collected'>('pending');
  const [list, setList] = useState<CheckRow[]>([]);
  const [payerName, setPayerName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [dueDate, setDueDate] = useState(todayIso());
  const [followUpDate, setFollowUpDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const load = useCallback(async () => {
    const status = tab === 'all' ? 'all' : tab;
    const data = await wsClient.request<CheckRow[]>('check.list', { status });
    setList(data);
  }, [tab]);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  // reload on tab
  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>یادآور چک</IonTitle>
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
          <div className="ios-section-title">ثبت چک جدید</div>
          <div className="ios-glass-card">
            <IonItem>
              <IonLabel position="stacked">پرداخت‌کننده</IonLabel>
              <IonInput
                value={payerName}
                placeholder="مثلاً آقای رضایی"
                onIonInput={(e) => setPayerName(e.detail.value || '')}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">بابت فاکتور شماره</IonLabel>
              <IonInput
                value={invoiceNumber}
                placeholder="مثلاً SAL-12"
                onIonInput={(e) => setInvoiceNumber(e.detail.value || '')}
              />
            </IonItem>
            <MoneyInput value={amount} onChange={(v) => setAmount(v)} />
            <DigitInput
              label="شماره چک"
              mode="int"
              value={checkNumber}
              onChange={setCheckNumber}
            />
            <IonItem>
              <IonLabel position="stacked">بانک</IonLabel>
              <IonInput value={bankName} onIonInput={(e) => setBankName(e.detail.value || '')} />
            </IonItem>
            <PersianDateField label="تاریخ سررسید چک" value={dueDate} onChange={setDueDate} />
            <PersianDateField
              label="تاریخ پیگیری"
              value={followUpDate}
              onChange={setFollowUpDate}
            />
            <IonItem>
              <IonLabel position="stacked">یادداشت</IonLabel>
              <IonInput value={notes} onIonInput={(e) => setNotes(e.detail.value || '')} />
            </IonItem>
            <IonButton
              expand="block"
              className="ios-primary-btn"
              onClick={async () => {
                try {
                  const parsed = parseAmount(amount);
                  if (!payerName.trim() || !parsed) throw new Error('نام و مبلغ الزامی است');
                  await wsClient.request(
                    'check.create',
                    {
                      payerName: payerName.trim(),
                      invoiceNumber: invoiceNumber.trim() || undefined,
                      amount: parsed,
                      checkNumber: checkNumber.trim() || undefined,
                      bankName: bankName.trim() || undefined,
                      dueDate,
                      followUpDate,
                      notes: notes.trim() || undefined,
                    },
                    { clientMutationId: newMutationId(), queueIfOffline: true }
                  );
                  setPayerName('');
                  setInvoiceNumber('');
                  setAmount('');
                  setCheckNumber('');
                  setNotes('');
                  setToast({ open: true, msg: 'چک ثبت شد — در موعد پیگیری می‌شود', color: 'success' });
                  await load();
                } catch (e) {
                  setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
                }
              }}
            >
              ثبت یادآور چک
            </IonButton>
          </div>

          <IonSegment
            value={tab}
            className="ios-segment"
            onIonChange={(e) => {
              setTab((e.detail.value as typeof tab) || 'pending');
              setTimeout(() => void load(), 0);
            }}
          >
            <IonSegmentButton value="pending">
              <IonLabel>باز</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="collected">
              <IonLabel>وصول‌شده</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="all">
              <IonLabel>همه</IonLabel>
            </IonSegmentButton>
          </IonSegment>

          {list.length === 0 && <div className="empty-state">چکی نیست</div>}

          {list.map((c) => {
            const overdue = c.status === 'pending' && new Date(c.followUpDate) <= new Date();
            return (
              <div key={c._id} className={`ios-glass-card ${overdue ? 'check-overdue' : ''}`}>
                <div className="ios-row">
                  <div>
                    <strong>{c.payerName}</strong>
                    <div className="ios-caption">
                      {c.invoiceNumber ? `فاکتور ${c.invoiceNumber}` : 'بدون فاکتور'}
                      {c.checkNumber ? ` · چک ${c.checkNumber}` : ''}
                      {c.bankName ? ` · ${c.bankName}` : ''}
                    </div>
                  </div>
                  <IonBadge color={overdue ? 'danger' : c.status === 'collected' ? 'success' : 'warning'}>
                    {overdue ? 'پیگیری!' : STATUS[c.status] || c.status}
                  </IonBadge>
                </div>
                <div className="stat-row">
                  <span className="stat-label">مبلغ</span>
                  <span className="stat-value">{formatToman(c.amount)}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">سررسید</span>
                  <span className="stat-value">{formatDate(c.dueDate)}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">پیگیری</span>
                  <span className="stat-value">{formatDate(c.followUpDate)}</span>
                </div>
                {c.notes && <p className="hint">{c.notes}</p>}
                {c.status === 'pending' && (
                  <div className="chip-row">
                    <IonButton
                      size="small"
                      color="success"
                      onClick={async () => {
                        await wsClient.request('check.update', { id: c._id, status: 'collected' });
                        setToast({ open: true, msg: 'وصول شد', color: 'success' });
                        await load();
                      }}
                    >
                      وصول شد
                    </IonButton>
                    <IonButton
                      size="small"
                      color="danger"
                      fill="outline"
                      onClick={async () => {
                        await wsClient.request('check.update', { id: c._id, status: 'bounced' });
                        setToast({ open: true, msg: 'برگشت ثبت شد', color: 'warning' });
                        await load();
                      }}
                    >
                      برگشت خورد
                    </IonButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>

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

export default Checks;
