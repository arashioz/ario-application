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
  IonIcon,
  useIonViewWillEnter,
} from '@ionic/react';
import { trashOutline } from 'ionicons/icons';
import { wsClient } from '../api/ws';
import { useAuth } from '../auth/AuthContext';

interface Category {
  _id: string;
  name: string;
  profitPercent: number;
  profitRetail?: number;
  profitSupermarket?: number;
  profitWholesale?: number;
}

const Categories: React.FC = () => {
  const { isAdmin } = useAuth();
  const [cats, setCats] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [retail, setRetail] = useState('15');
  const [superM, setSuperM] = useState('10');
  const [wholesale, setWholesale] = useState('6');
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const [edits, setEdits] = useState<
    Record<string, { retail: string; supermarket: string; wholesale: string }>
  >({});

  const load = useCallback(async () => {
    const list = await wsClient.request<Category[]>('category.list');
    setCats(list);
    const map: typeof edits = {};
    for (const c of list) {
      map[c._id] = {
        retail: String(c.profitRetail ?? c.profitPercent ?? 15),
        supermarket: String(c.profitSupermarket ?? 10),
        wholesale: String(c.profitWholesale ?? 6),
      };
    }
    setEdits(map);
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  if (!isAdmin) {
    return (
      <IonPage>
        <IonContent>
          <p className="empty-state">فقط مدیر</p>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>دسته‌ها و سود</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <div className="ion-padding compact">
          <div className="ios-glass-card">
            <IonItem>
              <IonLabel position="stacked">نام دسته</IonLabel>
              <IonInput value={name} onIonInput={(e) => setName(e.detail.value || '')} />
            </IonItem>
            <div className="profit-row">
              <IonItem>
                <IonLabel position="stacked">تکی %</IonLabel>
                <IonInput type="number" value={retail} onIonInput={(e) => setRetail(e.detail.value || '')} />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">سوپر %</IonLabel>
                <IonInput type="number" value={superM} onIonInput={(e) => setSuperM(e.detail.value || '')} />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">عمده %</IonLabel>
                <IonInput
                  type="number"
                  value={wholesale}
                  onIonInput={(e) => setWholesale(e.detail.value || '')}
                />
              </IonItem>
            </div>
            <IonButton
              expand="block"
              className="ios-primary-btn"
              onClick={async () => {
                try {
                  await wsClient.request('category.create', {
                    name: name.trim(),
                    profitRetail: parseFloat(retail) || 15,
                    profitSupermarket: parseFloat(superM) || 10,
                    profitWholesale: parseFloat(wholesale) || 6,
                    profitPercent: parseFloat(retail) || 15,
                  });
                  setName('');
                  await load();
                  setToast({ open: true, msg: 'دسته ساخته شد', color: 'success' });
                } catch (e) {
                  setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
                }
              }}
            >
              افزودن دسته
            </IonButton>
          </div>

          {cats.map((c) => (
            <div key={c._id} className="ios-glass-card">
              <div className="ios-row">
                <strong>{c.name}</strong>
                <IonButton
                  fill="clear"
                  color="danger"
                  size="small"
                  onClick={async () => {
                    if (!window.confirm(`حذف دسته «${c.name}»؟`)) return;
                    try {
                      await wsClient.request('category.delete', { id: c._id });
                      await load();
                      setToast({ open: true, msg: 'حذف شد', color: 'success' });
                    } catch (e) {
                      setToast({
                        open: true,
                        msg: e instanceof Error ? e.message : 'خطا',
                        color: 'danger',
                      });
                    }
                  }}
                >
                  <IonIcon icon={trashOutline} />
                </IonButton>
              </div>
              <div className="profit-row">
                <IonItem>
                  <IonLabel position="stacked">تکی %</IonLabel>
                  <IonInput
                    type="number"
                    value={edits[c._id]?.retail ?? ''}
                    onIonInput={(e) =>
                      setEdits({
                        ...edits,
                        [c._id]: { ...edits[c._id], retail: e.detail.value || '' },
                      })
                    }
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">سوپر %</IonLabel>
                  <IonInput
                    type="number"
                    value={edits[c._id]?.supermarket ?? ''}
                    onIonInput={(e) =>
                      setEdits({
                        ...edits,
                        [c._id]: { ...edits[c._id], supermarket: e.detail.value || '' },
                      })
                    }
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">عمده %</IonLabel>
                  <IonInput
                    type="number"
                    value={edits[c._id]?.wholesale ?? ''}
                    onIonInput={(e) =>
                      setEdits({
                        ...edits,
                        [c._id]: { ...edits[c._id], wholesale: e.detail.value || '' },
                      })
                    }
                  />
                </IonItem>
              </div>
              <IonButton
                expand="block"
                size="small"
                fill="outline"
                onClick={async () => {
                  try {
                    const e = edits[c._id];
                    await wsClient.request('category.update', {
                      id: c._id,
                      profitRetail: parseFloat(e?.retail || '0'),
                      profitSupermarket: parseFloat(e?.supermarket || '0'),
                      profitWholesale: parseFloat(e?.wholesale || '0'),
                    });
                    await load();
                    setToast({ open: true, msg: 'ذخیره شد', color: 'success' });
                  } catch (err) {
                    setToast({
                      open: true,
                      msg: err instanceof Error ? err.message : 'خطا',
                      color: 'danger',
                    });
                  }
                }}
              >
                ذخیره درصدها
              </IonButton>
            </div>
          ))}
        </div>
        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2000}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default Categories;
