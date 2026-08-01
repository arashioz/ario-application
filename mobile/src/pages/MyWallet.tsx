import { useCallback, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { wsClient, newMutationId } from '../api/ws';
import { formatToman, formatMoneyInput, parseAmount, formatDate } from '../utils/format';
import { MoneyInput } from '../components/MoneyInput';
import { useAuth } from '../auth/AuthContext';

interface Tx {
  _id: string;
  type: string;
  amount: number;
  direction: string;
  description: string;
  balanceAfter: number;
  createdAt: string;
}

const MyWallet: React.FC = () => {
  const { isAdmin } = useAuth();
  const [balance, setBalance] = useState(0);
  const [cardNumber, setCardNumber] = useState('');
  const [txs, setTxs] = useState<Tx[]>([]);
  const [payUserId, setPayUserId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [partners, setPartners] = useState<Array<{ _id: string; name: string; walletBalance?: number }>>(
    []
  );
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const load = useCallback(async () => {
    const w = await wsClient.request<{
      balance: number;
      cardNumber: string;
      transactions: Tx[];
    }>('wallet.get', {});
    setBalance(w.balance || 0);
    setCardNumber(w.cardNumber || '');
    setTxs(w.transactions || []);
    if (isAdmin) {
      const users = await wsClient.request<Array<{ _id: string; name: string; role: string; walletBalance?: number }>>(
        'user.list',
        {}
      );
      setPartners((users || []).filter((u) => u.role === 'marketer'));
    }
  }, [isAdmin]);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>کیف پول</IonTitle>
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
          <div className="ios-kpi-grid">
            <div className="ios-kpi teal">
              <div className="k-label">موجودی</div>
              <div className="k-value">{formatToman(balance)}</div>
            </div>
          </div>

          <div className="ios-glass-card">
            <IonItem>
              <IonLabel position="stacked">شماره کارت برای تسویه</IonLabel>
              <IonInput
                value={cardNumber}
                onIonBlur={(e) => {
                  const v = String((e.target as HTMLIonInputElement).value ?? '');
                  void wsClient
                    .request('driver.profile.update', { cardNumber: v })
                    .then(() => {
                      setCardNumber(v);
                      setToast({ open: true, msg: 'کارت ذخیره شد', color: 'success' });
                    })
                    .catch(console.warn);
                }}
              />
            </IonItem>
            <p className="hint">با روشن بودن کار و فروش، پورسانت اینجا می‌آید</p>
          </div>

          {isAdmin && (
            <div className="ios-glass-card">
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                تسویه همکار (ادمین)
              </div>
              <div className="chip-row">
                {partners.map((p) => (
                  <IonButton
                    key={p._id}
                    size="small"
                    fill={payUserId === p._id ? 'solid' : 'outline'}
                    onClick={() => {
                      setPayUserId(p._id);
                      setPayAmount(formatMoneyInput(String(p.walletBalance || 0)));
                    }}
                  >
                    {p.name} · {formatToman(p.walletBalance || 0)}
                  </IonButton>
                ))}
              </div>
              <MoneyInput label="مبلغ پرداخت" value={payAmount} onChange={setPayAmount} />
              <IonButton
                expand="block"
                color="success"
                disabled={!payUserId}
                onClick={async () => {
                  try {
                    const res = await wsClient.request<{ paid: number }>(
                      'wallet.pay',
                      { userId: payUserId, amount: parseAmount(payAmount) || 0 },
                      { clientMutationId: newMutationId(), queueIfOffline: true }
                    );
                    setToast({
                      open: true,
                      msg: `پرداخت ${formatToman(res.paid)} ثبت شد`,
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
                پرداخت شد
              </IonButton>
            </div>
          )}

          <div className="ios-section-title">گردش کیف پول</div>
          {txs.length === 0 && <p className="hint">هنوز تراکنشی نیست</p>}
          {txs.map((t) => (
            <div key={t._id} className="ios-glass-card">
              <div className="ios-row">
                <strong>{t.description}</strong>
                <span className={t.direction === 'in' ? 'stat-value success' : 'stat-value'}>
                  {t.direction === 'in' ? '+' : '−'}
                  {formatToman(t.amount)}
                </span>
              </div>
              <div className="ios-caption">
                {formatDate(t.createdAt)} · موجودی بعد: {formatToman(t.balanceAfter)}
              </div>
            </div>
          ))}
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

export default MyWallet;
