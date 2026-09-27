import { useCallback, useState } from 'react';
import {
  IonAlert,
  IonBackButton,
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonTitle,
  IonToast,
  IonToolbar,
  RefresherEventDetail,
  useIonViewWillEnter,
} from '@ionic/react';
import { downloadOutline, trashOutline, cloudDoneOutline } from 'ionicons/icons';
import { Redirect } from 'react-router-dom';
import { wsClient } from '../api/ws';
import { adminDownload, adminRequest } from '../api/admin';
import { useAuth } from '../auth/AuthContext';
import { formatDateTime } from '../utils/format';
import { PersianDateField } from '../components/PersianDateField';

type ExportKind = 'sales' | 'purchases' | 'expenses' | 'customers' | 'database' | 'history';

type BackupInfo = {
  file: string;
  kind: 'manual' | 'auto';
  size: number;
  createdAt: string;
  totalDocuments?: number;
  collections?: Array<{ name: string; count: number }>;
};

type CollectionRow = { name: string; count: number };

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

/** نام فارسی جدول‌های اصلی — بقیه با نام خودشان نمایش داده می‌شوند */
const COLLECTION_LABELS: Record<string, string> = {
  companypayments: 'پرداخت‌ها به شرکت',
  supplierdebts: 'بدهی‌های شرکت',
  cashtransactions: 'گردش صندوق',
  purchaseinvoices: 'فاکتورهای خرید',
  saleinvoices: 'فاکتورهای فروش',
  expenses: 'هزینه‌ها',
  expensecategories: 'دسته‌های هزینه',
  debtors: 'بدهکاران',
  customers: 'مشتریان',
  products: 'محصولات',
  categories: 'دسته‌بندی محصولات',
  shopsettings: 'تنظیمات',
  users: 'کاربران',
  checkreminders: 'چک‌ها',
  salestargets: 'تارگت‌ها',
  campaigns: 'کمپین‌ها',
  platformorders: 'سفارش‌های پلتفرم',
  wallettransactions: 'کیف پول',
  shopnotes: 'یادداشت‌ها',
  smsmessages: 'پیامک‌ها',
  mutationlogs: 'لاگ تغییرات',
};

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const faNum = (n: number) => n.toLocaleString('fa-IR');

const DataExport: React.FC = () => {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [financeFrom, setFinanceFrom] = useState('');
  const [financeTo, setFinanceTo] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const notify = (msg: string, color = 'success') => setToast({ open: true, msg, color });
  const fail = (e: unknown, fallback: string) => notify(e instanceof Error ? e.message : fallback, 'danger');

  const load = useCallback(async () => {
    const [b, c] = await Promise.all([
      adminRequest<BackupInfo[]>('/backups'),
      adminRequest<CollectionRow[]>('/collections'),
    ]);
    setBackups(b);
    setCollections(c);
  }, []);

  useIonViewWillEnter(() => {
    if (isAdmin) void load().catch((e) => fail(e, 'بارگذاری نشد'));
  });

  if (!isAdmin) return <Redirect to="/more" />;

  const run = async (key: string, fn: () => Promise<void>, fallback: string) => {
    setLoading(key);
    try {
      await fn();
    } catch (e) {
      fail(e, fallback);
    } finally {
      setLoading(null);
    }
  };

  const createBackup = (download: boolean) =>
    run(
      download ? 'backup-dl' : 'backup',
      async () => {
        const info = await adminRequest<BackupInfo>('/backups', { method: 'POST' });
        if (download) await adminDownload(`/backups/${encodeURIComponent(info.file)}/download`, info.file);
        notify(`بکاپ کامل ساخته شد · ${faNum(info.totalDocuments || 0)} رکورد`);
        await load();
      },
      'ساخت بکاپ انجام نشد'
    );

  const financeQuery = () => {
    const q = new URLSearchParams();
    if (financeFrom) q.set('from', financeFrom);
    if (financeTo) q.set('to', financeTo);
    const s = q.toString();
    return s ? `?${s}` : '';
  };

  const legacyDownload = (item: (typeof exportsList)[number]) =>
    run(
      item.kind,
      async () => {
        const data = await wsClient.request('export.create', { kind: item.kind });
        saveJson(data, item.filename);
        notify('فایل JSON دانلود شد');
      },
      'ساخت خروجی انجام نشد'
    );

  const spinnerOr = (key: string, icon: string) =>
    loading === key ? <IonSpinner name="crescent" /> : <IonIcon icon={icon} />;

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
        <IonRefresher
          slot="fixed"
          onIonRefresh={(e: CustomEvent<RefresherEventDetail>) =>
            void load()
              .catch((err) => fail(err, 'بارگذاری نشد'))
              .finally(() => e.detail.complete())
          }
        >
          <IonRefresherContent />
        </IonRefresher>

        <div className="ion-padding compact">
          {/* ─── بکاپ کامل روی سرور ─── */}
          <div className="ios-glass-card">
            <h2 style={{ marginTop: 0 }}>بکاپ کامل دیتابیس روی سرور</h2>
            <p className="hint">
              همهٔ جدول‌ها و همهٔ رکوردها در یک فایل JSON روی سرور ذخیره می‌شود. هر روز هم یک بکاپ خودکار
              گرفته می‌شود و ۱۴ بکاپ خودکار آخر نگه داشته می‌شود؛ بکاپ‌های دستی پاک نمی‌شوند.
            </p>
            <div className="chip-row">
              <IonButton
                className="ios-primary-btn"
                disabled={loading !== null}
                onClick={() => void createBackup(false)}
              >
                {loading === 'backup' ? <IonSpinner name="crescent" /> : 'ساخت بکاپ روی سرور'}
              </IonButton>
              <IonButton fill="outline" disabled={loading !== null} onClick={() => void createBackup(true)}>
                {loading === 'backup-dl' ? <IonSpinner name="crescent" /> : 'بکاپ + دانلود'}
              </IonButton>
            </div>

            <div className="ios-section-title">بکاپ‌های ذخیره‌شده ({faNum(backups.length)})</div>
            {backups.length === 0 && <p className="hint">هنوز بکاپی روی سرور نیست</p>}
            <IonList lines="full" inset={false}>
              {backups.map((b) => (
                <IonItem key={b.file}>
                  <IonIcon icon={cloudDoneOutline} slot="start" color={b.kind === 'auto' ? 'medium' : 'success'} />
                  <IonLabel>
                    <strong>{formatDateTime(b.createdAt)}</strong>
                    <p>
                      <IonChip className="ios-chip" style={{ height: 20, fontSize: 11, margin: 0 }}>
                        {b.kind === 'auto' ? 'خودکار' : 'دستی'}
                      </IonChip>{' '}
                      {formatSize(b.size)}
                      {b.totalDocuments !== undefined ? ` · ${faNum(b.totalDocuments)} رکورد` : ''}
                      {b.collections ? ` · ${faNum(b.collections.length)} جدول` : ''}
                    </p>
                  </IonLabel>
                  <IonButton
                    slot="end"
                    fill="clear"
                    aria-label="دانلود بکاپ"
                    disabled={loading !== null}
                    onClick={() =>
                      void run(
                        `dl:${b.file}`,
                        () => adminDownload(`/backups/${encodeURIComponent(b.file)}/download`, b.file),
                        'دانلود نشد'
                      )
                    }
                  >
                    {spinnerOr(`dl:${b.file}`, downloadOutline)}
                  </IonButton>
                  <IonButton
                    slot="end"
                    fill="clear"
                    color="danger"
                    aria-label="حذف بکاپ"
                    disabled={loading !== null}
                    onClick={() => setConfirmDelete(b.file)}
                  >
                    <IonIcon icon={trashOutline} />
                  </IonButton>
                </IonItem>
              ))}
            </IonList>
          </div>

          {/* ─── پرداخت به شرکت و صندوق ─── */}
          <div className="ios-glass-card" style={{ marginTop: 12 }}>
            <h2 style={{ marginTop: 0 }}>پرداخت به شرکت و صندوق</h2>
            <p className="hint">
              خلاصه، پرداخت‌ها به شرکت، بدهی‌های شرکت، خریدها، گردش صندوق و برداشت شخصی. بدون انتخاب تاریخ،
              کل تاریخچه خروجی گرفته می‌شود.
            </p>
            <PersianDateField label="از تاریخ" value={financeFrom} onChange={setFinanceFrom} />
            <PersianDateField label="تا تاریخ" value={financeTo} onChange={setFinanceTo} />
            {(financeFrom || financeTo) && (
              <IonButton
                size="small"
                fill="clear"
                onClick={() => {
                  setFinanceFrom('');
                  setFinanceTo('');
                }}
              >
                کل تاریخچه (پاک کردن تاریخ)
              </IonButton>
            )}
            <div className="chip-row" style={{ marginTop: 8 }}>
              <IonButton
                className="ios-primary-btn"
                disabled={loading !== null}
                onClick={() =>
                  void run(
                    'fin-xlsx',
                    async () => {
                      await adminDownload(`/export/finance.xlsx${financeQuery()}`, 'ario-finance.xlsx');
                      notify('فایل Excel دانلود شد');
                    },
                    'خروجی Excel ساخته نشد'
                  )
                }
              >
                {loading === 'fin-xlsx' ? <IonSpinner name="crescent" /> : 'دانلود Excel'}
              </IonButton>
              <IonButton
                fill="outline"
                disabled={loading !== null}
                onClick={() =>
                  void run(
                    'fin-json',
                    async () => {
                      await adminDownload(`/export/finance.json${financeQuery()}`, 'ario-finance.json');
                      notify('فایل JSON دانلود شد');
                    },
                    'خروجی JSON ساخته نشد'
                  )
                }
              >
                {loading === 'fin-json' ? <IonSpinner name="crescent" /> : 'دانلود JSON'}
              </IonButton>
            </div>
          </div>

          {/* ─── هر جدول جداگانه ─── */}
          <div className="ios-glass-card" style={{ marginTop: 12 }}>
            <h2 style={{ marginTop: 0 }}>JSON هر جدول به‌صورت جداگانه</h2>
            <p className="hint">
              خروجی خام و کامل همهٔ document‌های هر جدول. فرمت فایل با <code>mongoimport --jsonArray</code>{' '}
              قابل بازگردانی است.
            </p>
            <IonList lines="full" inset={false}>
              {collections.map((c) => (
                <IonItem key={c.name}>
                  <IonLabel>
                    <strong>{COLLECTION_LABELS[c.name] || c.name}</strong>
                    <p>
                      {c.name} · {faNum(c.count)} رکورد
                    </p>
                  </IonLabel>
                  <IonButton
                    slot="end"
                    fill="clear"
                    aria-label={`دانلود ${c.name}`}
                    disabled={loading !== null}
                    onClick={() =>
                      void run(
                        `col:${c.name}`,
                        () => adminDownload(`/collections/${encodeURIComponent(c.name)}/export`, `${c.name}.json`),
                        'دانلود نشد'
                      )
                    }
                  >
                    {spinnerOr(`col:${c.name}`, downloadOutline)}
                  </IonButton>
                </IonItem>
              ))}
            </IonList>
          </div>

          {/* ─── خروجی‌های گزارشی قبلی ─── */}
          <div className="ios-glass-card" style={{ marginTop: 12 }}>
            <h2 style={{ marginTop: 0 }}>خروجی‌های گزارشی</h2>
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
                    onClick={() => void legacyDownload(item)}
                  >
                    {spinnerOr(item.kind, downloadOutline)}
                  </IonButton>
                </IonItem>
              ))}
            </IonList>
            <p className="hint">
              نشست‌های ورود (توکن‌ها) در هیچ خروجی و بکاپی قرار نمی‌گیرند. بکاپ کامل شامل جدول کاربران است
              تا بازگردانی کامل ممکن باشد — فایل بکاپ را امن نگه دارید.
            </p>
          </div>
        </div>

        <IonAlert
          isOpen={!!confirmDelete}
          header="حذف بکاپ"
          message="این فایل بکاپ از روی سرور حذف شود؟"
          buttons={[
            { text: 'انصراف', role: 'cancel' },
            {
              text: 'حذف',
              role: 'destructive',
              handler: () => {
                const file = confirmDelete;
                if (!file) return;
                void run(
                  `del:${file}`,
                  async () => {
                    await adminRequest(`/backups/${encodeURIComponent(file)}`, { method: 'DELETE' });
                    notify('بکاپ حذف شد');
                    await load();
                  },
                  'حذف نشد'
                );
              },
            },
          ]}
          onDidDismiss={() => setConfirmDelete(null)}
        />
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
