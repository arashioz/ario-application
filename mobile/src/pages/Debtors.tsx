import { useCallback, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonChip,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { wsClient, newMutationId } from '../api/ws';
import { formatRial, formatDate, parseAmount, formatMoneyInput, sanitizeNumberInput } from '../utils/format';

interface Debtor {
  _id: string;
  name: string;
  phone?: string;
  amount: number;
  paidAmount: number;
  dueDate: string;
}

const Debtors: React.FC = () => {
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>({});
  const [payMethods, setPayMethods] = useState<Record<string, 'cash' | 'card'>>({});
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const load = useCallback(async () => {
    setDebtors(await wsClient.request<Debtor[]>('debtor.list', { settled: false }));
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="primary">
          <IonTitle>نسیه</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="page-content">
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
          {debtors.length === 0 && <div className="empty-state">بدهکار فعالی نیست</div>}
          {debtors.map((d) => {
            const remaining = d.amount - d.paidAmount;
            const overdue = new Date(d.dueDate) < new Date();
            const method = payMethods[d._id] || 'cash';
            return (
              <IonCard key={d._id} className="tight-card">
                <IonCardContent>
                  <div className="stat-row">
                    <span className={`stat-value bold ${overdue ? 'danger' : ''}`}>
                      {overdue ? '⚠ ' : ''}
                      {d.name}
                    </span>
                    <span className="stat-label">{d.phone}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">مانده</span>
                    <span className="stat-value danger">{formatRial(remaining)}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">سررسید</span>
                    <span className="stat-value">{formatDate(d.dueDate)}</span>
                  </div>
                  <div className="chip-row">
                    <IonChip
                      color={method === 'cash' ? 'success' : 'medium'}
                      outline={method !== 'cash'}
                      onClick={() => setPayMethods({ ...payMethods, [d._id]: 'cash' })}
                    >
                      نقد
                    </IonChip>
                    <IonChip
                      color={method === 'card' ? 'primary' : 'medium'}
                      outline={method !== 'card'}
                      onClick={() => setPayMethods({ ...payMethods, [d._id]: 'card' })}
                    >
                      کارت
                    </IonChip>
                  </div>
                  <IonItem>
                    <IonLabel position="stacked">مبلغ دریافت (تومان)</IonLabel>
                    <IonInput
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={payAmounts[d._id] || ''}
                      onIonInput={(e) =>
                        setPayAmounts({ ...payAmounts, [d._id]: formatMoneyInput(e.detail.value || '') })
                      }
                    />
                  </IonItem>
                  <IonButton
                    expand="block"
                    size="small"
                    onClick={async () => {
                      const amount = parseAmount(payAmounts[d._id] || '');
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
                        setToast({ open: true, msg: 'ثبت شد', color: 'success' });
                        await load();
                      } catch (e) {
                        setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
                      }
                    }}
                  >
                    ثبت دریافت
                  </IonButton>
                </IonCardContent>
              </IonCard>
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

export default Debtors;
