import { useEffect, useRef, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonFooter,
  IonButton,
  IonButtons,
  IonIcon,
  IonTextarea,
  IonSpinner,
  IonToast,
  IonChip,
} from '@ionic/react';
import { sendOutline, clipboardOutline, sparklesOutline, checkmarkDoneOutline } from 'ionicons/icons';
import { wsClient, newMutationId } from '../api/ws';
import { onDeviceLlm } from '../chatbot/localLlm';
import { formatToman } from '../utils/format';

interface Msg {
  id: string;
  role: 'user' | 'bot';
  text: string;
  action?: string;
  entities?: Record<string, string | number | boolean>;
  rawUserText?: string;
}

const WELCOME: Msg = {
  id: '0',
  role: 'bot',
  text: `دستیار آریو آماده‌ست.

مثال:
• «۲۰ کیلو قند ۵ کیلویی به احمد نقد»
• «سود امروز»
• «بدهکارام»
• «واریز کارتخوان ۵ میلیون»`,
};

const CONFIRMABLE = new Set(['create_sale', 'create_purchase', 'create_expense', 'card_deposit']);

const Chat: React.FC = () => {
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const contentRef = useRef<HTMLIonContentElement>(null);

  const scrollBottom = () => setTimeout(() => contentRef.current?.scrollToBottom(250), 60);
  const add = (m: Msg) => {
    setMessages((p) => [...p, m]);
    scrollBottom();
  };

  const send = async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;
    setInput('');
    add({ id: `${Date.now()}`, role: 'user', text: userText });
    setLoading(true);
    try {
      const local = onDeviceLlm.process(userText);
      let botText = local.text;
      let action = local.suggestedAction;
      let entities = local.entities;
      try {
        const server = await wsClient.request<{
          text: string;
          suggestedAction?: string;
          intent?: { entities: Record<string, string | number | boolean> };
        }>('chat.message', { message: userText });
        botText = server.text;
        action = server.suggestedAction || action;
        entities = server.intent?.entities ?? entities;
      } catch {
        botText += '\n\n(آفلاین — موتور محلی)';
      }
      add({
        id: `${Date.now()}-b`,
        role: 'bot',
        text: botText,
        action,
        entities,
        rawUserText: userText,
      });
    } finally {
      setLoading(false);
    }
  };

  const confirm = async (msg: Msg) => {
    if (!msg.action || !CONFIRMABLE.has(msg.action)) return;
    setConfirming(msg.id);
    try {
      const e = msg.entities || {};
      let data: Record<string, unknown> = {};

      if (msg.action === 'create_sale') {
        const qty = Number(e.quantity || 1);
        const unit = /بسته/.test(msg.rawUserText || '') ? 'package' : 'kg';
        data = {
          customerName: e.customerName,
          customerPhone: e.phone,
          paymentMethod: e.paymentMethod || 'cash',
          items: [
            {
              productName: e.productName,
              unit,
              qtyInput: e.amount && !e.quantity ? 1 : qty,
              quantity: qty,
              unitPrice: e.amount ? Math.round(Number(e.amount) / (unit === 'kg' ? qty : 1)) : undefined,
            },
          ],
        };
        // اگر مبلغ کل است برای کیلو
        if (e.amount && e.productName) {
          data.items = [
            {
              productName: String(e.productName),
              unit: /کیلو/.test(msg.rawUserText || '') ? 'kg' : unit,
              qtyInput: Number(e.quantity || qty),
              unitPrice: e.amount
                ? Math.round(Number(e.amount) / Math.max(Number(e.quantity || qty), 1))
                : undefined,
            },
          ];
        }
      } else if (msg.action === 'create_expense') {
        data = {
          type: e.expenseType || 'other',
          amount: e.amount,
          description: String(e.productName || msg.rawUserText || 'هزینه چت'),
        };
      } else if (msg.action === 'card_deposit') {
        data = { amount: e.amount, description: 'واریز از چت' };
      } else if (msg.action === 'create_purchase') {
        const cats = await wsClient.request<Array<{ _id: string; name: string }>>('category.list');
        const categoryId = cats.find((c) => /قند|سایر/i.test(c.name))?._id || cats[0]?._id;
        data = {
          items: [
            {
              name: e.productName,
              categoryId,
              unit: 'kg',
              qtyInput: Number(e.quantity || 1),
              unitPrice: Number(e.amount || 0),
              kgPerPackage: 5,
            },
          ],
          paidNow: false,
        };
      }

      await wsClient.request(
        'chat.confirm',
        { action: msg.action, data },
        { clientMutationId: newMutationId(), queueIfOffline: true }
      );
      add({ id: `${Date.now()}`, role: 'bot', text: 'ثبت شد ✓' });
      setToast({ open: true, msg: 'عملیات ثبت شد', color: 'success' });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'خطا';
      add({ id: `${Date.now()}`, role: 'bot', text: `خطا: ${reason}` });
      setToast({ open: true, msg: reason, color: 'danger' });
    } finally {
      setConfirming(null);
    }
  };

  useEffect(() => {
    scrollBottom();
  }, [messages.length]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="primary">
          <IonTitle>
            <IonIcon icon={sparklesOutline} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
            دستیار
          </IonTitle>
          <IonButtons slot="end">
            <IonButton
              onClick={async () => {
                try {
                  const t = await navigator.clipboard.readText();
                  if (t) setInput(t);
                } catch {
                  setToast({ open: true, msg: 'کلیپبورد در دسترس نیست', color: 'warning' });
                }
              }}
            >
              <IonIcon slot="icon-only" icon={clipboardOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent ref={contentRef} className="page-content">
        <div className="ion-padding compact">
          <div className="chip-row">
            {['سود امروز', 'بدهکارام رو نشون بده', 'راهنما'].map((p) => (
              <IonChip key={p} color="primary" outline onClick={() => void send(p)}>
                {p}
              </IonChip>
            ))}
          </div>
          {messages.map((m) => (
            <div key={m.id} className={`chat-bubble ${m.role}`}>
              {m.text}
              {m.role === 'bot' && m.action && CONFIRMABLE.has(m.action) && (
                <div className="chat-actions">
                  <IonButton size="small" color="success" disabled={confirming === m.id} onClick={() => void confirm(m)}>
                    {confirming === m.id ? (
                      <IonSpinner name="crescent" />
                    ) : (
                      <>
                        <IonIcon slot="start" icon={checkmarkDoneOutline} />
                        تأیید و ثبت
                      </>
                    )}
                  </IonButton>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="chat-bubble bot">
              <IonSpinner name="dots" /> تحلیل…
            </div>
          )}
        </div>
      </IonContent>
      <IonFooter>
        <IonToolbar style={{ '--background': '#fff', padding: '4px 6px' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <IonTextarea
              value={input}
              autoGrow
              rows={1}
              placeholder="سفارش بنویسید…"
              onIonInput={(e) => setInput(e.detail.value || '')}
              style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 14, padding: '2px 10px', maxHeight: 100 }}
            />
            <IonButton shape="round" disabled={loading || !input.trim()} onClick={() => void send()} style={{ width: 44, height: 44, margin: 0 }}>
              <IonIcon slot="icon-only" icon={sendOutline} />
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
      <IonToast
        isOpen={toast.open}
        message={toast.msg}
        color={toast.color}
        duration={2200}
        onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
        position="top"
      />
    </IonPage>
  );
};

export default Chat;
