import { useCallback, useEffect, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonButton,
  IonToast,
  IonBadge,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
  IonToggle,
} from '@ionic/react';
import { wsClient } from '../api/ws';

interface Partner {
  _id: string;
  name: string;
  username: string;
  phone?: string;
  city?: string;
  approvalStatus: string;
  canSelfDeliver?: boolean;
  createdAt?: string;
}

const PartnerApprovals: React.FC = () => {
  const [list, setList] = useState<Partner[]>([]);
  const [selfDeliver, setSelfDeliver] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const load = useCallback(async () => {
    const data = await wsClient.request<Partner[]>('partner.list', { status: 'pending' });
    setList(Array.isArray(data) ? data : []);
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  useEffect(() => {
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === 'partner') void load().catch(console.warn);
    });
    return unsub;
  }, [load]);

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>تأیید همکاران</IonTitle>
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
          {list.length === 0 && <div className="empty-state">درخواستی در صف نیست</div>}
          {list.map((u) => (
            <div key={u._id} className="ios-glass-card">
              <div className="ios-row">
                <div>
                  <strong>{u.name}</strong>
                  <div className="ios-caption">
                    @{u.username} · {u.city || '—'} · {u.phone || ''}
                  </div>
                </div>
                <IonBadge color="warning">{u.approvalStatus}</IonBadge>
              </div>
              <div className="ios-row" style={{ marginTop: 8 }}>
                <span>اجازه پخش شخصی</span>
                <IonToggle
                  checked={selfDeliver[u._id] ?? true}
                  onIonChange={(e) =>
                    setSelfDeliver({ ...selfDeliver, [u._id]: e.detail.checked })
                  }
                />
              </div>
              <div className="chip-row" style={{ marginTop: 8 }}>
                <IonButton
                  size="small"
                  color="success"
                  onClick={async () => {
                    try {
                      await wsClient.request('partner.approve', {
                        id: u._id,
                        canSelfDeliver: selfDeliver[u._id] ?? true,
                      });
                      setToast({ open: true, msg: 'تأیید شد', color: 'success' });
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
                  تأیید
                </IonButton>
                <IonButton
                  size="small"
                  color="danger"
                  fill="outline"
                  onClick={async () => {
                    try {
                      await wsClient.request('partner.reject', { id: u._id });
                      setToast({ open: true, msg: 'رد شد', color: 'warning' });
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
                  رد
                </IonButton>
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

export default PartnerApprovals;
