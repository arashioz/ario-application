import { useCallback, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
  useIonViewWillEnter,
} from '@ionic/react';
import {
  personOutline,
  peopleOutline,
  walletOutline,
  calendarOutline,
  flagOutline,
  fileTrayFullOutline,
  documentTextOutline,
  navigateOutline,
  listOutline,
  mapOutline,
  giftOutline,
  bicycleOutline,
  pricetagOutline,
  settingsOutline,
  peopleCircleOutline,
  storefrontOutline,
} from 'ionicons/icons';
import { useAuth } from '../auth/AuthContext';
import { wsClient } from '../api/ws';

const More: React.FC = () => {
  const { isAdmin, user, online, queueLen, logout } = useAuth();
  const [driverPanelEnabled, setDriverPanelEnabled] = useState(true);
  const [marketerPanelEnabled, setMarketerPanelEnabled] = useState(true);

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

  const links = [
    {
      href: '/catalog-admin',
      icon: pricetagOutline,
      label: 'مدیریت محصولات',
      desc: 'دسته، درصد سود، عکس، قیمت تکی/سوپر/عمده',
    },
    ...(isAdmin && marketerPanelEnabled
      ? [
          {
            href: '/partner-approvals',
            icon: peopleCircleOutline,
            label: 'تأیید همکاران',
            desc: 'ثبت‌نام‌های جدید · فعال / رد',
          },
          {
            href: '/platform-settings',
            icon: storefrontOutline,
            label: 'تنظیمات پلتفرم',
            desc: 'درصد پورسانت، پخش، حداقل حجم',
          },
        ]
      : []),
    ...(marketerPanelEnabled
      ? [
          {
            href: '/my-wallet',
            icon: walletOutline,
            label: 'کیف پول من',
            desc: 'پورسانت، موجودی، درخواست تسویه',
          },
          {
            href: '/volume-orders',
            icon: storefrontOutline,
            label: 'سفارش حجمی',
            desc: 'سفارش سوپر/عمده برای شهر خودت',
          },
        ]
      : isAdmin
        ? []
        : [
            {
              href: '/my-wallet',
              icon: walletOutline,
              label: 'کیف پول من',
              desc: 'پورسانت، موجودی، درخواست تسویه',
            },
          ]),
    {
      href: '/app-settings',
      icon: settingsOutline,
      label: 'تنظیمات اپ',
      desc: isAdmin ? 'نام مغازه · خاموش/روشن پنل راننده و بازاریاب' : 'نام مغازه و تنظیمات عمومی',
    },
    {
      href: '/invoices',
      icon: listOutline,
      label: 'لیست فاکتورها',
      desc: 'فروش و خرید یکجا · جزئیات و PDF',
    },
    {
      href: '/customers-map',
      icon: mapOutline,
      label: 'نقشه مشتریان',
      desc: 'موقعیت، آخرین ویزیت، فاکتورها',
    },
    { href: '/orders', icon: fileTrayFullOutline, label: 'سفارش‌ها', desc: 'تأیید، ارسال شده، PDF' },
    { href: '/checks', icon: documentTextOutline, label: 'یادآور چک', desc: 'پیگیری سررسید چک' },
    ...(isAdmin && driverPanelEnabled
      ? [
          { href: '/drivers-map', icon: navigateOutline, label: 'نقشه راننده‌ها', desc: 'موقعیت زنده' },
          {
            href: '/driver-payouts',
            icon: bicycleOutline,
            label: 'پرداخت راننده‌ها',
            desc: 'شماره کارت، کیف پول ارسال',
          },
        ]
      : []),
    { href: '/customers', icon: personOutline, label: 'مشتریان', desc: 'آدرس و نقشه' },
    { href: '/debtors', icon: peopleOutline, label: 'نسیه / بدهکاران', desc: 'دریافت بدهی' },
    ...(isAdmin
      ? [
          { href: '/expense', icon: walletOutline, label: 'هزینه و شرکت', desc: 'لیست هزینه، واریز، پرداخت' },
          ...(marketerPanelEnabled
            ? [
                {
                  href: '/campaigns',
                  icon: giftOutline,
                  label: 'جشنواره / تخفیف فروش',
                  desc: 'پکیج، حجمی، نقدی — برای بازاریاب',
                },
                { href: '/targets', icon: flagOutline, label: 'تارگت بازاریاب', desc: 'هدف ماهانه' },
              ]
            : []),
        ]
      : []),
    {
      href: '/history',
      icon: calendarOutline,
      label: 'صندوق شرکت',
      desc: 'موجودی نقد و کارت، گردش صندوق، گزارش',
    },
  ];

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>بیشتر</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <div className="ion-padding compact">
          <div className="ios-glass-card ios-row">
            <div>
              <strong>{user?.name}</strong>
              <div className="ios-caption">
                {user?.role === 'admin' ? 'مدیر' : 'بازاریاب'} · {online ? 'آنلاین' : 'آفلاین'}
                {queueLen > 0 ? ` · صف ${queueLen}` : ''}
              </div>
            </div>
            <button type="button" className="date-card" onClick={() => void logout()}>
              خروج
            </button>
          </div>

          {isAdmin && (
            <p className="hint convert-hint">
              پنل راننده: {driverPanelEnabled ? 'روشن' : 'خاموش'} · پنل بازاریاب:{' '}
              {marketerPanelEnabled ? 'روشن' : 'خاموش'} — از تنظیمات اپ عوض کنید
            </p>
          )}

          <IonList className="more-list">
            {links.map((l) => (
              <IonItem key={l.href} routerLink={l.href} detail={false} className="more-item">
                <IonIcon slot="start" icon={l.icon} color="primary" />
                <IonLabel>
                  <h2>{l.label}</h2>
                  <p>{l.desc}</p>
                </IonLabel>
              </IonItem>
            ))}
          </IonList>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default More;
