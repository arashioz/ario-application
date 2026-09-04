import { useState } from 'react';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToast,
  IonToolbar,
} from '@ionic/react';
import { downloadOutline } from 'ionicons/icons';
import { Redirect } from 'react-router-dom';
import { wsClient } from '../api/ws';
import { useAuth } from '../auth/AuthContext';

type ExportKind = 'sales' | 'purchases' | 'expenses' | 'customers' | 'database' | 'history';

const exportsList: Array<{ kind: ExportKind; title: string; description: string; filename: string }> = [
  { kind: 'sales', title: 'فاکتورهای فروش', description: 'همهٔ فاکتورها و اقلام فروش', filename: 'sale-invoices' },
  { kind: 'purchases', title: 'فاکتورهای خرید', description: 'همهٔ فاکتورها و اقلام خرید', filename: 'purchase-invoices' },
  { kind: 'expenses', title: 'هزینه‌ها', description: 'تمام هزینه‌ها با تاریخ و روش پرداخت', filename: 'expenses' },
  {
    kind: 'customers',
    title: 'مشتریان، لوکیشن و فاکتورها',
    description: 'هر مشتری همراه آدرس، مختصات و تمام فاکتورهای فروشش',
    filename: 'customers-with-invoices',
  },
  {
    kind: 'history',
    title: 'تاریخچه‌ها',
    description: 'صندوق، پیامک، تغییرات، یادداشت‌ها، چک و کیف‌پول',
    filename: 'history',
  },
  {
    kind: 'database',
    title: 'خروجی کامل داده‌های مهم',
    description: 'محصولات، مشتری‌ها، فاکتورها، تنظیمات، تاریخچه و مسیر فایل‌ها',
    filename: 'database-backup',
  },
];

function saveJson(data: unknown, filename: string) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const DataExport: React.FC = () => {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState<ExportKind | null>(null);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  if (!isAdmin) return <Redirect to="/more" />;

  const download = async (item: (typeof exportsList)[number]) => {
    setLoading(item.kind);
    try {
      const data = await wsClient.request('export.create', { kind: item.kind });
      saveJson(data, item.filename);
      setToast({ open: true, msg: 'فایل JSON دانلود شد', color: 'success' });
    } catch (error) {
      setToast({
        open: true,
        msg: error instanceof Error ? error.message : 'ساخت خروجی انجام نشد',
        color: 'danger',
      });
    } finally {
      setLoading(null);
    }
  };

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>خروجی و پشتیبان</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <div className="ion-padding compact">
          <div className="ios-glass-card">
            <h2 style={{ marginTop: 0 }}>دانلود اطلاعات</h2>
            <p className="hint">
              فایل‌ها با فرمت JSON دانلود می‌شوند. خروجی کامل برای نگهداری نسخهٔ پشتیبان مناسب است.
            </p>
            <IonList lines="full" inset={false}>
              {exportsList.map((item) => (
                <IonItem key={item.kind}>
                  <IonLabel>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </IonLabel>
                  <IonButton
                    slot="end"
                    fill="clear"
                    aria-label={`دانلود ${item.title}`}
                    disabled={loading !== null}
                    onClick={() => void download(item)}
                  >
                    {loading === item.kind ? <IonSpinner name="crescent" /> : <IonIcon icon={downloadOutline} />}
                  </IonButton>
                </IonItem>
              ))}
            </IonList>
            <p className="hint">
              برای امنیت، رمز کاربران، نشست‌های ورود و رمزهای مدیریتی در هیچ خروجی قرار نمی‌گیرند.
              مسیر و تاریخ به‌روزرسانی فایل‌های محصول در خروجی کامل ثبت می‌شود.
            </p>
          </div>
        </div>
        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2500}
          onDidDismiss={() => setToast((value) => ({ ...value, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default DataExport;
