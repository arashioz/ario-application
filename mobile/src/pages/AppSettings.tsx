import { useCallback, useRef, useState } from 'react';
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
  IonToggle,
  IonCheckbox,
  IonChip,
  IonIcon,
  IonSelect,
  IonSelectOption,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { addOutline, trashOutline, copyOutline } from 'ionicons/icons';
import { wsClient } from '../api/ws';
import { useAuth } from '../auth/AuthContext';
import { sanitizeNumberInput } from '../utils/format';
import { copyText } from '../utils/invoiceShare';

type BankCard = {
  label: string;
  cardNumber: string;
  accountHolder?: string;
  bankName?: string;
  isDefault?: boolean;
};

/** تنظیمات عمومی مغازه — برند و کاتالوگ در «مدیریت کاتالوگ» */
const AppSettings: React.FC = () => {
  const { isAdmin } = useAuth();
  const [shopName, setShopName] = useState('');
  const [driverPanelEnabled, setDriverPanelEnabled] = useState(true);
  const [marketerPanelEnabled, setMarketerPanelEnabled] = useState(true);
  const [mongoCompassUri, setMongoCompassUri] = useState('');
  const [mongoUriHint, setMongoUriHint] = useState('');
  const [wipeSections, setWipeSections] = useState<Array<{ key: string; label: string }>>([]);
  const [selectedWipe, setSelectedWipe] = useState<Record<string, boolean>>({});
  const [wipePassword, setWipePassword] = useState('');
  const [wiping, setWiping] = useState(false);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const [bankCards, setBankCards] = useState<BankCard[]>([]);
  const [newCard, setNewCard] = useState<BankCard>({
    label: '',
    cardNumber: '',
    accountHolder: '',
    bankName: '',
  });

  const [goldenAutoEnabled, setGoldenAutoEnabled] = useState(true);
  const [goldenMinKg, setGoldenMinKg] = useState('500');
  const [goldenGiftName, setGoldenGiftName] = useState('کارتن');
  const [goldenGiftQty, setGoldenGiftQty] = useState('1');
  const [goldenDiscPercent, setGoldenDiscPercent] = useState('5');

  const [actionPassword, setActionPassword] = useState('');
  const [wipePasswordSetting, setWipePasswordSetting] = useState('');
  const [currentLoginPw, setCurrentLoginPw] = useState('');
  const [newLoginUser, setNewLoginUser] = useState('');
  const [newLoginName, setNewLoginName] = useState('');
  const [newLoginPw, setNewLoginPw] = useState('');
  const [newLoginPw2, setNewLoginPw2] = useState('');
  const [userList, setUserList] = useState<
    Array<{ _id: string; username: string; name: string; role: string }>
  >([]);
  const [adminSetUserId, setAdminSetUserId] = useState('');
  const [adminSetUsername, setAdminSetUsername] = useState('');
  const [adminSetPw, setAdminSetPw] = useState('');
  const [adminConfirmPw, setAdminConfirmPw] = useState('');

  const load = useCallback(async () => {
    const s = await wsClient.request<{
      shopName?: string;
      driverPanelEnabled?: boolean;
      marketerPanelEnabled?: boolean;
      mongoCompassUri?: string;
      mongoUriHint?: string;
      bankCards?: BankCard[];
      goldenAutoEnabled?: boolean;
      goldenMinKg?: number;
      goldenSuggestGiftName?: string;
      goldenSuggestGiftQty?: number;
      goldenSuggestDiscountPercent?: number;
      actionPassword?: string;
      wipePassword?: string;
    }>('settings.get');
    setShopName(s.shopName || '');
    setDriverPanelEnabled(s.driverPanelEnabled !== false);
    setMarketerPanelEnabled(s.marketerPanelEnabled !== false);
    setMongoCompassUri(s.mongoCompassUri || s.mongoUriHint || '');
    setMongoUriHint(s.mongoUriHint || '');
    setBankCards(Array.isArray(s.bankCards) ? s.bankCards : []);
    setGoldenAutoEnabled(s.goldenAutoEnabled !== false);
    setGoldenMinKg(String(s.goldenMinKg ?? 500));
    setGoldenGiftName(s.goldenSuggestGiftName || 'کارتن');
    setGoldenGiftQty(String(s.goldenSuggestGiftQty ?? 1));
    setGoldenDiscPercent(String(s.goldenSuggestDiscountPercent ?? 5));
    setActionPassword(s.actionPassword || 'delete-ario');
    setWipePasswordSetting(s.wipePassword || 'wipe-ario-dev');
    if (isAdmin) {
      try {
        const users = await wsClient.request<typeof userList>('user.list', {});
        setUserList(Array.isArray(users) ? users : []);
      } catch {
        setUserList([]);
      }
      try {
        const w = await wsClient.request<{ sections: Array<{ key: string; label: string }> }>(
          'dev.wipe.sections'
        );
        setWipeSections(w.sections || []);
        const init: Record<string, boolean> = {};
        for (const sec of w.sections || []) init[sec.key] = false;
        setSelectedWipe(init);
      } catch {
        /* ignore */
      }
    }
  }, [isAdmin]);

  const skipToggleSave = useRef(true);
  useIonViewWillEnter(() => {
    skipToggleSave.current = true;
    void load()
      .catch(console.warn)
      .finally(() => {
        window.setTimeout(() => {
          skipToggleSave.current = false;
        }, 400);
      });
  });

  const copyUri = async () => {
    const text = mongoCompassUri || mongoUriHint;
    if (!text) return;
    const ok = await copyText(text);
    setToast({
      open: true,
      msg: ok ? 'آدرس کپی شد — در Compass پیست کنید' : text,
      color: ok ? 'success' : 'warning',
    });
  };

  const selectAllWipe = (on: boolean) => {
    const next: Record<string, boolean> = {};
    for (const s of wipeSections) next[s.key] = on;
    setSelectedWipe(next);
  };

  const runWipe = async () => {
    const sections = Object.keys(selectedWipe).filter((k) => selectedWipe[k]);
    if (!sections.length) {
      setToast({ open: true, msg: 'حداقل یک بخش را تیک بزنید', color: 'danger' });
      return;
    }
    if (!wipePassword.trim()) {
      setToast({ open: true, msg: 'رمز پاک‌سازی را وارد کنید', color: 'danger' });
      return;
    }
    if (
      !window.confirm(
        `آیا مطمئنید؟ این کار برگشت‌ناپذیر است.\n${sections.length} بخش پاک می‌شود.`
      )
    ) {
      return;
    }
    setWiping(true);
    try {
      const res = await wsClient.request<{ message: string }>('dev.wipe', {
        password: wipePassword,
        sections,
      });
      setWipePassword('');
      setToast({ open: true, msg: res.message || 'پاک شد', color: 'success' });
      selectAllWipe(false);
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'خطا',
        color: 'danger',
      });
    } finally {
      setWiping(false);
    }
  };

  const saveBankCards = async (next: BankCard[]) => {
    try {
      await wsClient.request('settings.update', { bankCards: next });
      setBankCards(next);
      setToast({ open: true, msg: 'کارت‌ها ذخیره شد', color: 'success' });
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'ذخیره نشد',
        color: 'danger',
      });
    }
  };

  const addBankCard = () => {
    if (!newCard.label.trim() || !newCard.cardNumber.trim()) {
      setToast({ open: true, msg: 'عنوان و شماره کارت لازم است', color: 'danger' });
      return;
    }
    const next = [
      ...bankCards.map((c) => ({ ...c, isDefault: bankCards.length === 0 ? true : !!c.isDefault })),
      {
        label: newCard.label.trim(),
        cardNumber: newCard.cardNumber.replace(/\s+/g, ''),
        accountHolder: newCard.accountHolder?.trim() || undefined,
        bankName: newCard.bankName?.trim() || undefined,
        isDefault: bankCards.length === 0,
      },
    ];
    // اگر لیست قبلی پیش‌فرض نداشت، اولی را پیش‌فرض کن
    if (!next.some((c) => c.isDefault) && next.length) next[0].isDefault = true;
    setNewCard({ label: '', cardNumber: '', accountHolder: '', bankName: '' });
    void saveBankCards(next);
  };

  const setDefaultCard = (index: number) => {
    const next = bankCards.map((c, i) => ({ ...c, isDefault: i === index }));
    void saveBankCards(next);
  };

  const saveGolden = async () => {
    try {
      await wsClient.request('settings.update', {
        goldenAutoEnabled,
        goldenMinKg: parseFloat(goldenMinKg) || 500,
        goldenSuggestGiftName: goldenGiftName.trim() || 'کارتن',
        goldenSuggestGiftQty: parseFloat(goldenGiftQty) || 1,
        goldenSuggestDiscountPercent: parseFloat(goldenDiscPercent) || 5,
      });
      setToast({ open: true, msg: 'تنظیمات فاکتور طلایی ذخیره شد', color: 'success' });
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'خطا',
        color: 'danger',
      });
    }
  };

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>تنظیمات اپ</IonTitle>
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
          <div className="ios-glass-card" style={{ marginTop: 0 }}>
            <p className="hint">
              لینک کاتالوگ، برند، لوگو، عکس محصول و پله‌های قیمت در{' '}
              <a href="/catalog-admin">مدیریت کاتالوگ</a> است.
            </p>
            <IonItem>
              <IonLabel position="stacked">نام مغازه (سیستم داخلی)</IonLabel>
              <IonInput
                value={shopName}
                disabled={!isAdmin}
                onIonInput={(e) => setShopName(e.detail.value || '')}
              />
            </IonItem>
          </div>

          {isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 12 }}>
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                حساب‌های من (شماره کارت)
              </div>
              <p className="hint">
                کارت‌های فروشگاه را اینجا ثبت کنید. کارت «پیش‌فرض» همیشه پایین متن کپی فاکتور فروش
                برای مشتری می‌آید.
              </p>
              {bankCards.length === 0 && (
                <p className="hint convert-hint">هنوز کارتی ثبت نشده — یکی اضافه کنید</p>
              )}
              {bankCards.map((c, i) => (
                <div
                  key={`${c.cardNumber}-${i}`}
                  className={`ios-glass-card${c.isDefault ? ' in-cart' : ''}`}
                  style={{ marginBottom: 8 }}
                >
                  <div className="ios-row">
                    <div>
                      <strong>
                        {c.label}
                        {c.isDefault ? ' · پیش‌فرض' : ''}
                      </strong>
                      <div className="ios-caption">
                        {c.bankName ? `${c.bankName} · ` : ''}
                        {c.accountHolder || ''}
                      </div>
                      <div className="ios-caption" dir="ltr" style={{ textAlign: 'right' }}>
                        {c.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ')}
                      </div>
                    </div>
                    <div className="chip-row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {!c.isDefault && (
                        <IonButton size="small" fill="solid" onClick={() => setDefaultCard(i)}>
                          پیش‌فرض
                        </IonButton>
                      )}
                      {c.isDefault && (
                        <IonChip className="ios-chip-active" style={{ margin: 0 }}>
                          پیش‌فرض
                        </IonChip>
                      )}
                      <IonButton
                        size="small"
                        fill="outline"
                        onClick={() =>
                          void copyText(c.cardNumber).then((ok) =>
                            setToast({
                              open: true,
                              msg: ok ? 'شماره کارت کپی شد' : 'کپی نشد',
                              color: ok ? 'success' : 'danger',
                            })
                          )
                        }
                      >
                        <IonIcon slot="start" icon={copyOutline} />
                        کپی
                      </IonButton>
                      <IonButton
                        size="small"
                        fill="clear"
                        color="danger"
                        onClick={() => {
                          const next = bankCards.filter((_, j) => j !== i);
                          if (next.length && !next.some((x) => x.isDefault)) next[0].isDefault = true;
                          void saveBankCards(next);
                        }}
                      >
                        <IonIcon icon={trashOutline} />
                      </IonButton>
                    </div>
                  </div>
                </div>
              ))}
              <IonItem>
                <IonLabel position="stacked">عنوان (مثلاً کارت ملت)</IonLabel>
                <IonInput
                  value={newCard.label}
                  onIonInput={(e) => setNewCard({ ...newCard, label: e.detail.value || '' })}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">شماره کارت</IonLabel>
                <IonInput
                  inputMode="numeric"
                  value={newCard.cardNumber}
                  placeholder="6037…"
                  onIonInput={(e) =>
                    setNewCard({
                      ...newCard,
                      cardNumber: sanitizeNumberInput(e.detail.value || ''),
                    })
                  }
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">به نام</IonLabel>
                <IonInput
                  value={newCard.accountHolder || ''}
                  onIonInput={(e) =>
                    setNewCard({ ...newCard, accountHolder: e.detail.value || '' })
                  }
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">بانک (اختیاری)</IonLabel>
                <IonInput
                  value={newCard.bankName || ''}
                  onIonInput={(e) => setNewCard({ ...newCard, bankName: e.detail.value || '' })}
                />
              </IonItem>
              <IonButton
                expand="block"
                fill="outline"
                size="small"
                className="ion-margin-top"
                onClick={addBankCard}
              >
                <IonIcon slot="start" icon={addOutline} />
                افزودن کارت
              </IonButton>
            </div>
          )}

          {isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 12 }}>
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                فاکتور طلایی خودکار
              </div>
              <p className="hint">
                وقتی تناژ فاکتور از حد بگذرد، در فروش پیشنهاد تخفیف یا اشانتیون می‌آید
              </p>
              <div className="ios-row" style={{ padding: '8px 0' }}>
                <span>فعال</span>
                <IonToggle
                  checked={goldenAutoEnabled}
                  onIonChange={(e) => setGoldenAutoEnabled(e.detail.checked)}
                />
              </div>
              <IonItem>
                <IonLabel position="stacked">حداقل کیلو برای پیشنهاد</IonLabel>
                <IonInput
                  inputMode="numeric"
                  value={goldenMinKg}
                  onIonInput={(e) =>
                    setGoldenMinKg(sanitizeNumberInput(e.detail.value || '', { decimal: true }))
                  }
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">نام اشانتیون پیشنهادی</IonLabel>
                <IonInput
                  value={goldenGiftName}
                  placeholder="کارتن"
                  onIonInput={(e) => setGoldenGiftName(e.detail.value || '')}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">تعداد اشانتیون</IonLabel>
                <IonInput
                  inputMode="numeric"
                  value={goldenGiftQty}
                  onIonInput={(e) => setGoldenGiftQty(sanitizeNumberInput(e.detail.value || ''))}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">درصد تخفیف پیشنهادی</IonLabel>
                <IonInput
                  inputMode="numeric"
                  value={goldenDiscPercent}
                  onIonInput={(e) =>
                    setGoldenDiscPercent(sanitizeNumberInput(e.detail.value || '', { decimal: true }))
                  }
                />
              </IonItem>
              <IonButton expand="block" className="ios-primary-btn ion-margin-top" onClick={() => void saveGolden()}>
                ذخیره فاکتور طلایی
              </IonButton>
              <p className="hint" style={{ marginBottom: 0 }}>
                پیامک خودکار بعداً به سامانه پیامکی وصل می‌شود
              </p>
            </div>
          )}

          <div className="ios-glass-card" style={{ marginTop: 12 }}>
            <div className="ios-section-title" style={{ marginTop: 0 }}>
              حساب ورود من
            </div>
            <p className="hint">تغییر نام کاربری / رمز ورود با تأیید رمز فعلی</p>
            <IonItem>
              <IonLabel position="stacked">رمز فعلی</IonLabel>
              <IonInput
                type="password"
                value={currentLoginPw}
                onIonInput={(e) => setCurrentLoginPw(e.detail.value || '')}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">نام نمایشی جدید (اختیاری)</IonLabel>
              <IonInput value={newLoginName} onIonInput={(e) => setNewLoginName(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">نام کاربری جدید (اختیاری)</IonLabel>
              <IonInput
                value={newLoginUser}
                onIonInput={(e) => setNewLoginUser(e.detail.value || '')}
                autocomplete="off"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">رمز ورود جدید (اختیاری)</IonLabel>
              <IonInput
                type="password"
                value={newLoginPw}
                onIonInput={(e) => setNewLoginPw(e.detail.value || '')}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">تکرار رمز جدید</IonLabel>
              <IonInput
                type="password"
                value={newLoginPw2}
                onIonInput={(e) => setNewLoginPw2(e.detail.value || '')}
              />
            </IonItem>
            <IonButton
              expand="block"
              className="ios-primary-btn ion-margin-top"
              disabled={!currentLoginPw}
              onClick={async () => {
                if (newLoginPw && newLoginPw !== newLoginPw2) {
                  setToast({ open: true, msg: 'تکرار رمز جدید یکسان نیست', color: 'danger' });
                  return;
                }
                try {
                  await wsClient.request('auth.changePassword', {
                    currentPassword: currentLoginPw,
                    newPassword: newLoginPw || undefined,
                    newUsername: newLoginUser.trim() || undefined,
                    newName: newLoginName.trim() || undefined,
                  });
                  setToast({ open: true, msg: 'حساب به‌روز شد — با رمز جدید وارد شوید', color: 'success' });
                  setCurrentLoginPw('');
                  setNewLoginPw('');
                  setNewLoginPw2('');
                  setNewLoginUser('');
                  setNewLoginName('');
                } catch (e) {
                  setToast({
                    open: true,
                    msg: e instanceof Error ? e.message : 'خطا',
                    color: 'danger',
                  });
                }
              }}
            >
              ذخیره حساب من
            </IonButton>
          </div>

          {isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 12 }}>
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                رمز عملیات حساس
              </div>
              <p className="hint">
                همین رمز برای حذف/ویرایش فاکتور، اصلاح موجودی، غیرفعال کردن فاکتور و … استفاده می‌شود
              </p>
              <IonItem>
                <IonLabel position="stacked">رمز عملیات</IonLabel>
                <IonInput
                  type="password"
                  value={actionPassword}
                  onIonInput={(e) => setActionPassword(e.detail.value || '')}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">رمز پاک‌سازی توسعه</IonLabel>
                <IonInput
                  type="password"
                  value={wipePasswordSetting}
                  onIonInput={(e) => setWipePasswordSetting(e.detail.value || '')}
                />
              </IonItem>
              <IonButton
                expand="block"
                className="ios-primary-btn ion-margin-top"
                onClick={async () => {
                  try {
                    await wsClient.request('settings.update', {
                      actionPassword: actionPassword.trim(),
                      wipePassword: wipePasswordSetting.trim(),
                    });
                    setToast({ open: true, msg: 'رمزها ذخیره شد', color: 'success' });
                  } catch (e) {
                    setToast({
                      open: true,
                      msg: e instanceof Error ? e.message : 'خطا',
                      color: 'danger',
                    });
                  }
                }}
              >
                ذخیره رمزها
              </IonButton>
            </div>
          )}

          {isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 12 }}>
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                تغییر رمز کاربران
              </div>
              <p className="hint">با رمز ورود خودتان، رمز/نام‌کاربری دیگران را عوض کنید</p>
              <IonItem>
                <IonLabel position="stacked">کاربر</IonLabel>
                <IonSelect
                  value={adminSetUserId}
                  placeholder="انتخاب…"
                  interface="popover"
                  onIonChange={(e) => {
                    const id = String(e.detail.value || '');
                    setAdminSetUserId(id);
                    const u = userList.find((x) => x._id === id);
                    setAdminSetUsername(u?.username || '');
                  }}
                >
                  {userList.map((u) => (
                    <IonSelectOption key={u._id} value={u._id}>
                      {u.name} ({u.username}) — {u.role}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">نام کاربری جدید</IonLabel>
                <IonInput
                  value={adminSetUsername}
                  onIonInput={(e) => setAdminSetUsername(e.detail.value || '')}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">رمز جدید</IonLabel>
                <IonInput
                  type="password"
                  value={adminSetPw}
                  onIonInput={(e) => setAdminSetPw(e.detail.value || '')}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">رمز ورود مدیر (تأیید)</IonLabel>
                <IonInput
                  type="password"
                  value={adminConfirmPw}
                  onIonInput={(e) => setAdminConfirmPw(e.detail.value || '')}
                />
              </IonItem>
              <IonButton
                expand="block"
                color="warning"
                className="ion-margin-top"
                disabled={!adminSetUserId || !adminConfirmPw}
                onClick={async () => {
                  try {
                    await wsClient.request('auth.adminSetUser', {
                      userId: adminSetUserId,
                      username: adminSetUsername.trim() || undefined,
                      password: adminSetPw || undefined,
                      adminPassword: adminConfirmPw,
                    });
                    setToast({ open: true, msg: 'کاربر به‌روز شد', color: 'success' });
                    setAdminSetPw('');
                    setAdminConfirmPw('');
                    const users = await wsClient.request<typeof userList>('user.list', {});
                    setUserList(Array.isArray(users) ? users : []);
                  } catch (e) {
                    setToast({
                      open: true,
                      msg: e instanceof Error ? e.message : 'خطا',
                      color: 'danger',
                    });
                  }
                }}
              >
                اعمال روی کاربر
              </IonButton>
            </div>
          )}

          {isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 12 }}>
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                پنل‌ها
              </div>
              <p className="hint">سوییچ را بزنید — بلافاصله ذخیره می‌شود و منوی بیشتر به‌روز می‌شود</p>
              <IonItem lines="full">
                <IonLabel>
                  <h3>پنل راننده</h3>
                  <p>نقشه راننده‌ها، پرداخت راننده، اپ ارسال</p>
                </IonLabel>
                <IonToggle
                  checked={driverPanelEnabled}
                  onIonChange={(e) => {
                    const checked = e.detail.checked;
                    if (skipToggleSave.current) return;
                    if (checked === driverPanelEnabled) return;
                    setDriverPanelEnabled(checked);
                    void wsClient
                      .request('settings.update', { driverPanelEnabled: checked })
                      .then(() =>
                        setToast({
                          open: true,
                          msg: checked ? 'پنل راننده روشن شد' : 'پنل راننده خاموش شد',
                          color: 'success',
                        })
                      )
                      .catch((err) => {
                        setDriverPanelEnabled(!checked);
                        setToast({
                          open: true,
                          msg: err instanceof Error ? err.message : 'خطا',
                          color: 'danger',
                        });
                      });
                  }}
                />
              </IonItem>
              <IonItem lines="none">
                <IonLabel>
                  <h3>پنل بازاریاب</h3>
                  <p>ثبت‌نام همکار، سفارش حجمی، تارگت</p>
                </IonLabel>
                <IonToggle
                  checked={marketerPanelEnabled}
                  onIonChange={(e) => {
                    const checked = e.detail.checked;
                    if (skipToggleSave.current) return;
                    if (checked === marketerPanelEnabled) return;
                    setMarketerPanelEnabled(checked);
                    void wsClient
                      .request('settings.update', { marketerPanelEnabled: checked })
                      .then(() =>
                        setToast({
                          open: true,
                          msg: checked ? 'پنل بازاریاب روشن شد' : 'پنل بازاریاب خاموش شد',
                          color: 'success',
                        })
                      )
                      .catch((err) => {
                        setMarketerPanelEnabled(!checked);
                        setToast({
                          open: true,
                          msg: err instanceof Error ? err.message : 'خطا',
                          color: 'danger',
                        });
                      });
                  }}
                />
              </IonItem>
              <IonButton
                expand="block"
                className="ios-primary-btn"
                onClick={async () => {
                  try {
                    await wsClient.request('settings.update', {
                      shopName,
                      driverPanelEnabled,
                      marketerPanelEnabled,
                      mongoCompassUri,
                    });
                    setToast({ open: true, msg: 'ذخیره شد', color: 'success' });
                  } catch (e) {
                    setToast({
                      open: true,
                      msg: e instanceof Error ? e.message : 'خطا',
                      color: 'danger',
                    });
                  }
                }}
              >
                ذخیره نام مغازه
              </IonButton>
            </div>
          )}

          {isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 12 }}>
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                MongoDB Compass
              </div>
              <p className="hint">
                آدرس اتصال را در MongoDB Compass پیست کنید. اگر مونگو روی سرور است، IP عمومی و پورت
                ۲۷۰۱۷ را باز کنید.
              </p>
              {mongoUriHint && (
                <p className="hint convert-hint" style={{ marginTop: 0 }}>
                  پیشنهاد سرور: {mongoUriHint}
                </p>
              )}
              <IonItem lines="full">
                <IonLabel position="stacked">Connection URI</IonLabel>
                <IonInput
                  value={mongoCompassUri}
                  placeholder="mongodb://127.0.0.1:27017/ario-shop"
                  onIonInput={(e) => setMongoCompassUri(e.detail.value || '')}
                />
              </IonItem>
              <div className="chip-row" style={{ marginTop: 8 }}>
                <IonButton size="small" fill="outline" onClick={() => void copyUri()}>
                  کپی URI
                </IonButton>
                {mongoUriHint && (
                  <IonButton size="small" fill="clear" onClick={() => setMongoCompassUri(mongoUriHint)}>
                    از پیشنهاد سرور
                  </IonButton>
                )}
                <IonButton
                  size="small"
                  className="ios-primary-btn"
                  onClick={async () => {
                    try {
                      await wsClient.request('settings.update', { mongoCompassUri });
                      setToast({ open: true, msg: 'آدرس مونگو ذخیره شد', color: 'success' });
                    } catch (e) {
                      setToast({
                        open: true,
                        msg: e instanceof Error ? e.message : 'خطا',
                        color: 'danger',
                      });
                    }
                  }}
                >
                  ذخیره URI
                </IonButton>
              </div>
            </div>
          )}

          {isAdmin && wipeSections.length > 0 && (
            <div className="ios-glass-card wipe-card" style={{ marginTop: 12 }}>
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                پاک‌سازی توسعه
              </div>
              <p className="hint">
                فقط برای حالت توسعه. رمز از تنظیمات «رمز پاک‌سازی» — پیش‌فرض: <code>wipe-ario-dev</code> — کاربران ادمین حذف نمی‌شوند.
              </p>
              <div className="chip-row" style={{ marginBottom: 8 }}>
                <IonButton size="small" fill="outline" onClick={() => selectAllWipe(true)}>
                  همه
                </IonButton>
                <IonButton size="small" fill="clear" onClick={() => selectAllWipe(false)}>
                  هیچ‌کدام
                </IonButton>
              </div>
              {wipeSections.map((s) => (
                <IonItem key={s.key} lines="full" className="wipe-item">
                  <IonCheckbox
                    slot="start"
                    checked={!!selectedWipe[s.key]}
                    onIonChange={(e) =>
                      setSelectedWipe((prev) => ({ ...prev, [s.key]: e.detail.checked }))
                    }
                  />
                  <IonLabel>{s.label}</IonLabel>
                </IonItem>
              ))}
              <IonItem lines="full">
                <IonLabel position="stacked">رمز پاک‌سازی</IonLabel>
                <IonInput
                  type="password"
                  value={wipePassword}
                  placeholder="wipe-ario-dev"
                  onIonInput={(e) => setWipePassword(e.detail.value || '')}
                />
              </IonItem>
              <IonButton
                expand="block"
                color="danger"
                className="ion-margin-top"
                disabled={wiping}
                onClick={() => void runWipe()}
              >
                {wiping ? 'در حال پاک‌سازی…' : 'پاک کردن بخش‌های انتخاب‌شده'}
              </IonButton>
            </div>
          )}

          {!isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 12 }}>
              <p className="hint">فقط مدیر می‌تواند تنظیمات را تغییر دهد</p>
            </div>
          )}
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

export default AppSettings;
