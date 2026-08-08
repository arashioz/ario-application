import { useCallback, useEffect, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonIcon,
  IonInput,
  IonRefresher,
  IonRefresherContent,
  IonToast,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { addOutline, trashOutline } from 'ionicons/icons';
import { wsClient } from '../api/ws';

type ShopNote = {
  id: string;
  text: string;
  done: boolean;
  color: 'yellow' | 'mint' | 'peach' | 'sky' | 'lavender';
};

const Notes: React.FC = () => {
  const [notes, setNotes] = useState<ShopNote[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'danger' });

  const load = useCallback(async () => {
    try {
      const list = await wsClient.request<ShopNote[]>('note.list', { includeDone: true });
      const rows = Array.isArray(list) ? list : [];
      setNotes([...rows.filter((n) => !n.done), ...rows.filter((n) => n.done)]);
    } catch {
      setNotes([]);
    }
  }, []);

  useIonViewWillEnter(() => {
    void load();
  });

  useEffect(() => {
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === 'note') void load();
    });
    return unsub;
  }, [load]);

  const add = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await wsClient.request('note.create', { text });
      setDraft('');
      await load();
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'ذخیره نشد',
        color: 'danger',
      });
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (id: string) => {
    try {
      await wsClient.request('note.toggle', { id });
      await load();
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'خطا',
        color: 'danger',
      });
    }
  };

  const remove = async (id: string) => {
    try {
      await wsClient.request('note.delete', { id });
      await load();
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'حذف نشد',
        color: 'danger',
      });
    }
  };

  const openCount = notes.filter((n) => !n.done).length;

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/dashboard" text="خانه" />
          </IonButtons>
          <IonTitle>یادداشت‌ها</IonTitle>
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

        <div className="ion-padding">
          <div className="sticky-board">
            <div className="sticky-board-head">
              <strong>تخته یادداشت</strong>
              <span className="ios-caption">
                {openCount > 0
                  ? `${openCount.toLocaleString('fa-IR')} باز`
                  : 'همه‌چیز انجام شده'}
              </span>
            </div>
            <div className="sticky-add">
              <IonInput
                className="sticky-input"
                value={draft}
                placeholder="مثلاً: فردا چک آقای …"
                maxlength={200}
                onIonInput={(e) => setDraft(e.detail.value || '')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void add();
                  }
                }}
              />
              <button
                type="button"
                className="sticky-add-btn"
                disabled={saving || !draft.trim()}
                onClick={() => void add()}
                aria-label="افزودن"
              >
                <IonIcon icon={addOutline} />
              </button>
            </div>
            <div className="sticky-grid">
              {notes.length === 0 && (
                <div className="sticky-empty">
                  هنوز یادداشتی نیست — بنویس تا برای همه دیده شود
                </div>
              )}
              {notes.map((n, i) => (
                <div
                  key={n.id}
                  className={`sticky-note color-${n.color}${n.done ? ' done' : ''}`}
                  style={{ transform: `rotate(${((i % 5) - 2) * 1.2}deg)` }}
                >
                  <button
                    type="button"
                    className="sticky-check"
                    onClick={() => void toggle(n.id)}
                    aria-label={n.done ? 'باز کردن' : 'انجام شد'}
                  >
                    {n.done ? '✓' : '○'}
                  </button>
                  <p className="sticky-text">{n.text}</p>
                  <button
                    type="button"
                    className="sticky-del"
                    onClick={() => void remove(n.id)}
                    aria-label="حذف"
                  >
                    <IonIcon icon={trashOutline} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={1800}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default Notes;
