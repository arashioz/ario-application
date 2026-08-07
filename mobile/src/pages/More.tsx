import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonIcon,
  IonRouterLink,
  IonToast,
  useIonViewWillEnter,
} from '@ionic/react';
import {
  peopleOutline,
  walletOutline,
  flagOutline,
  fileTrayFullOutline,
  documentTextOutline,
  navigateOutline,
  listOutline,
  locationOutline,
  giftOutline,
  bicycleOutline,
  pricetagOutline,
  settingsOutline,
  peopleCircleOutline,
  storefrontOutline,
  flashOutline,
  cloudOfflineOutline,
  cloudDoneOutline,
  bagHandleOutline,
  cashOutline,
  pieChartOutline,
  personOutline,
} from 'ionicons/icons';
import { useAuth } from '../auth/AuthContext';
import { wsClient } from '../api/ws';

type MoreLink = {
  href: string;
  icon: string;
  label: string;
  desc: string;
};

type MoreGroup = {
  title: string;
  items: MoreLink[];
};

const More: React.FC = () => {
  const { isAdmin, user, online, queueLen, logout } = useAuth();
  const [driverPanelEnabled, setDriverPanelEnabled] = useState(true);
  const [marketerPanelEnabled, setMarketerPanelEnabled] = useState(true);
  const [savingFlag, setSavingFlag] = useState<'driver' | 'marketer' | null>(null);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const loadFlags = useCallback(async () => {
    try {
      const s = await wsClient.request<{
        driverPanelEnabled?: boolean;
        marketerPanelEnabled?: boolean;
      }>('settings.get');
      setDriverPanelEnabled(s.driverPanelEnabled !== false);
      setMarketerPanelEnabled(s.marketerPanelEnabled !== false);
    } catch {
      /* ignore */
    }
  }, []);

  useIonViewWillEnter(() => {
    void loadFlags();
  });

  useEffect(() => {
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === 'settings') void loadFlags();
    });
    return unsub;
  }, [loadFlags]);

  const togglePanel = async (kind: 'driver' | 'marketer') => {
    if (!isAdmin || savingFlag) return;
    const nextDriver = kind === 'driver' ? !driverPanelEnabled : driverPanelEnabled;
    const nextMarketer = kind === 'marketer' ? !marketerPanelEnabled : marketerPanelEnabled;
    setSavingFlag(kind);
    if (kind === 'driver') setDriverPanelEnabled(nextDriver);
    else setMarketerPanelEnabled(nextMarketer);
    try {
      await wsClient.request('settings.update', {
        driverPanelEnabled: nextDriver,
        marketerPanelEnabled: nextMarketer,
      });
      setToast({
        open: true,
        msg:
          kind === 'driver'
            ? nextDriver
              ? 'پنل راننده روشن شد'
              : 'پنل راننده خاموش شد'
            : nextMarketer
              ? 'پنل بازاریاب روشن شد'
              : 'پنل بازاریاب خاموش شد',
        color: 'success',
      });
    } catch (e) {
      if (kind === 'driver') setDriverPanelEnabled(!nextDriver);
      else setMarketerPanelEnabled(!nextMarketer);
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'ذخیره نشد',
        color: 'danger',
      });
    } finally {
      setSavingFlag(null);
    }
  };

  const groups = useMemo((): MoreGroup[] => {
    const catalog: MoreLink[] = [
      {
        href: '/catalog-admin',
        icon: pricetagOutline,
        label: 'محصولات',
        desc: 'کاتالوگ و سود',
      },
      {
        href: '/app-settings',
        icon: settingsOutline,
        label: 'تنظیمات',
        desc: isAdmin ? 'اپ و توسعه' : 'عمومی',
      },
    ];

    const opsDaily: MoreLink[] = [
      { href: '/orders', icon: fileTrayFullOutline, label: 'سفارش‌ها', desc: 'تأیید و ارسال' },
    ];
    if (isAdmin) {
      opsDaily.unshift({
        href: '/purchase',
        icon: bagHandleOutline,
        label: 'خرید',
        desc: 'فاکتور خرید',
      });
    }

    const salesReports: MoreLink[] = [
      {
        href: '/invoices',
        icon: listOutline,
        label: 'فاکتورها',
        desc: 'فروش و خرید',
      },
      {
        href: '/customers',
        icon: personOutline,
        label: 'مشتریان',
        desc: 'لیست و گزارش',
      },
      {
        href: '/customers-map',
        icon: locationOutline,
        label: 'نقشه',
        desc: 'موقعیت مشتری',
      },
      { href: '/debtors', icon: peopleOutline, label: 'نسیه', desc: 'بدهکاران' },
    ];

    const financeReports: MoreLink[] = [
      {
        href: '/history',
        icon: cashOutline,
        label: 'صندوق',
        desc: 'موجودی و بازه',
      },
      {
        href: '/reports',
        icon: pieChartOutline,
        label: 'گزارش مالی',
        desc: 'سود و هزینه',
      },
      { href: '/checks', icon: documentTextOutline, label: 'چک', desc: 'یادآور سررسید' },
    ];
    if (isAdmin) {
      financeReports.splice(1, 0, {
        href: '/expense',
        icon: walletOutline,
        label: 'هزینه',
        desc: 'شرکت و واریز',
      });
    }

    const partner: MoreLink[] = [];
    if (isAdmin) {
      partner.push({
        href: '/campaigns',
        icon: giftOutline,
        label: 'جشنواره',
        desc: 'تخفیف و اشانتیون',
      });
      if (marketerPanelEnabled) {
        partner.push(
          {
            href: '/partner-approvals',
            icon: peopleCircleOutline,
            label: 'همکاران',
            desc: 'تأیید ثبت‌نام',
          },
          {
            href: '/platform-settings',
            icon: storefrontOutline,
            label: 'پلتفرم',
            desc: 'پورسانت',
          },
          { href: '/targets', icon: flagOutline, label: 'تارگت', desc: 'هدف ماهانه' }
        );
      }
    }
    if (marketerPanelEnabled) {
      partner.push(
        {
          href: '/my-wallet',
          icon: walletOutline,
          label: 'کیف پول',
          desc: 'پورسانت',
        },
        {
          href: '/volume-orders',
          icon: storefrontOutline,
          label: 'سفارش حجمی',
          desc: 'سوپر / عمده',
        }
      );
    } else if (!isAdmin) {
      partner.push({
        href: '/my-wallet',
        icon: walletOutline,
        label: 'کیف پول',
        desc: 'پورسانت',
      });
    }

    const ops: MoreLink[] = [];
    if (isAdmin) {
      ops.push({
        href: '/drivers-map',
        icon: navigateOutline,
        label: 'نقشه تیم',
        desc: 'راننده و بازاریاب',
      });
      if (driverPanelEnabled) {
        ops.push({
          href: '/driver-payouts',
          icon: bicycleOutline,
          label: 'پرداخت راننده',
          desc: 'کارت و کیف',
        });
      }
    }

    const out: MoreGroup[] = [
      { title: 'خرید و سفارش', items: opsDaily },
      { title: 'گزارش فروش', items: salesReports },
      { title: 'گزارش مالی', items: financeReports },
      { title: 'کاتالوگ و تنظیمات', items: catalog },
    ];
    if (partner.length) out.push({ title: 'همکاران و جشنواره', items: partner });
    if (ops.length) out.push({ title: 'عملیات', items: ops });
    return out;
  }, [isAdmin, driverPanelEnabled, marketerPanelEnabled]);

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>بیشتر</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <div className="ion-padding compact more-page">
          <div className="more-profile">
            <div className="more-avatar">{(user?.name || '؟').slice(0, 1)}</div>
            <div className="more-profile-body">
              <strong className="more-name">{user?.name}</strong>
              <div className="more-meta">
                <span className="more-role-pill">
                  {user?.role === 'admin' ? 'مدیر' : 'بازاریاب'}
                </span>
                <span className={`more-status ${online ? 'on' : 'off'}`}>
                  <IonIcon icon={online ? cloudDoneOutline : cloudOfflineOutline} />
                  {online ? 'آنلاین' : 'آفلاین'}
                </span>
                {queueLen > 0 && (
                  <span className="more-queue">
                    <IonIcon icon={flashOutline} />
                    صف {queueLen}
                  </span>
                )}
              </div>
            </div>
            <button type="button" className="more-logout" onClick={() => void logout()}>
              خروج
            </button>
          </div>

          {isAdmin && (
            <div className="more-flags">
              <button
                type="button"
                className={`more-flag-btn ${driverPanelEnabled ? 'on' : 'off'}`}
                disabled={savingFlag === 'driver'}
                onClick={() => void togglePanel('driver')}
              >
                راننده {driverPanelEnabled ? 'روشن' : 'خاموش'}
              </button>
              <button
                type="button"
                className={`more-flag-btn ${marketerPanelEnabled ? 'on' : 'off'}`}
                disabled={savingFlag === 'marketer'}
                onClick={() => void togglePanel('marketer')}
              >
                بازاریاب {marketerPanelEnabled ? 'روشن' : 'خاموش'}
              </button>
            </div>
          )}

          {groups.map((g) => (
            <section key={g.title} className="more-group">
              <h3 className="more-group-title">{g.title}</h3>
              <div className="more-square-grid">
                {g.items.map((l) => (
                  <IonRouterLink key={l.href} routerLink={l.href} className="more-square">
                    <span className="more-square-icon" aria-hidden>
                      <IonIcon icon={l.icon} />
                    </span>
                    <span className="more-square-label">{l.label}</span>
                    <span className="more-square-desc">{l.desc}</span>
                  </IonRouterLink>
                ))}
              </div>
            </section>
          ))}
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

export default More;
