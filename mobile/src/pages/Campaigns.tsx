import { useCallback, useState } from 'react';
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
  IonToggle,
  IonChip,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { addOutline, trashOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';
import { wsClient } from '../api/ws';
import { MoneyInput } from '../components/MoneyInput';
import { parseAmount, formatMoneyInput, sanitizeNumberInput } from '../utils/format';

type RuleType =
  | 'bundle'
  | 'volume_kg'
  | 'volume_amount'
  | 'payment_cash'
  | 'payment_card'
  | 'loyalty'
  | 'free_gift';

interface RuleDraft {
  type: RuleType;
  label: string;
  discountPercent: string;
  minKg: string;
  minAmount: string;
  minInvoiceCount: string;
  minMonthKg: string;
  bundleAName: string;
  bundleAQty: string;
  bundleBName: string;
  bundleBQty: string;
  /** اشانتیون: خرید X → هدیه Y */
  triggerName: string;
  triggerQty: string;
  giftName: string;
  giftQty: string;
}

interface SuggestLine {
  productName: string;
  qty: string;
  unit: 'kg' | 'package';
}

interface CampaignRow {
  _id: string;
  name: string;
  description?: string;
  active: boolean;
  forMarketers: boolean;
  targetLoyaltyTiers?: Array<'gold' | 'silver' | 'bronze' | 'new'>;
  rules?: Array<{ type: string; label?: string; discountPercent: number }>;
  suggestedInvoice?: { title?: string; note?: string; lines?: Array<{ productName: string; qty: number; unit: string }> };
}

const emptyRule = (): RuleDraft => ({
  type: 'free_gift',
  label: '',
  discountPercent: '0',
  minKg: '500',
  minAmount: '10000000',
  minInvoiceCount: '3',
  minMonthKg: '2000',
  bundleAName: 'نایلون',
  bundleAQty: '20',
  bundleBName: 'کارتن',
  bundleBQty: '2',
  triggerName: 'کارتن',
  triggerQty: '10',
  giftName: 'کارتن',
  giftQty: '1',
});

const RULE_TYPES: Array<{ value: RuleType; label: string }> = [
  { value: 'free_gift', label: 'اشانتیون (مثلاً ۱۰ کارتن → ۱ رایگان)' },
  { value: 'bundle', label: 'پکیج (مثلاً ۲۰ نایلون + ۲ کارتن)' },
  { value: 'volume_kg', label: 'خرید حجمی (کیلو)' },
  { value: 'volume_amount', label: 'خرید مبلغی' },
  { value: 'payment_cash', label: 'پرداخت نقد' },
  { value: 'payment_card', label: 'پرداخت کارتی' },
  { value: 'loyalty', label: 'مشتری خوب / وفادار' },
];

const MARKETING_PRESETS: Array<{
  name: string;
  description: string;
  apply: () => { name: string; description: string; rule: RuleDraft };
}> = [
  {
    name: '۱۰+۱ کارتن',
    description: '۱۰ کارتن بخر، ۱ اشانتیون',
    apply: () => ({
      name: 'جشنواره ۱۰+۱ کارتن',
      description: 'با خرید ۱۰ کارتن، یک کارتن اشانتیون',
      rule: {
        ...emptyRule(),
        type: 'free_gift',
        label: 'اشانتیون ۱ کارتن',
        triggerName: 'کارتن',
        triggerQty: '10',
        giftName: 'کارتن',
        giftQty: '1',
        discountPercent: '0',
      },
    }),
  },
  {
    name: 'تخفیف حجمی',
    description: 'از ۵۰۰ کیلو ۵٪ تخفیف',
    apply: () => ({
      name: 'تخفیف خرید حجمی',
      description: 'برای سفارش‌های بالای ۵۰۰ کیلو',
      rule: {
        ...emptyRule(),
        type: 'volume_kg',
        label: 'تخفیف حجمی ۵٪',
        minKg: '500',
        discountPercent: '5',
      },
    }),
  },
  {
    name: 'پکیج نایلون+کارتن',
    description: '۲۰ نایلون + ۲ کارتن → تخفیف',
    apply: () => ({
      name: 'پکیج ویژه',
      description: 'خرید همزمان نایلون و کارتن',
      rule: {
        ...emptyRule(),
        type: 'bundle',
        label: 'پکیج ویژه ۸٪',
        discountPercent: '8',
        bundleAName: 'نایلون',
        bundleAQty: '20',
        bundleBName: 'کارتن',
        bundleBQty: '2',
      },
    }),
  },
];

const Campaigns: React.FC = () => {
  const [list, setList] = useState<CampaignRow[]>([]);
  const [name, setName] = useState('جشنواره فروش');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [forMarketers, setForMarketers] = useState(true);
  const [goldOnly, setGoldOnly] = useState(false);
  const [rule, setRule] = useState<RuleDraft>(emptyRule());
  const [suggestTitle, setSuggestTitle] = useState('فاکتور پیشنهادی جشنواره');
  const [suggestNote, setSuggestNote] = useState('');
  const [suggestLines, setSuggestLines] = useState<SuggestLine[]>([
    { productName: 'نایلون', qty: '20', unit: 'package' },
    { productName: 'کارتن', qty: '2', unit: 'package' },
  ]);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const data = await wsClient.request<CampaignRow[]>('campaign.list', {});
    setList(Array.isArray(data) ? data : []);
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  const buildRulePayload = () => {
    const percent = parseFloat(rule.discountPercent) || 0;
    const base = {
      type: rule.type,
      label: rule.label || undefined,
      discountPercent: percent,
    };
    if (rule.type === 'bundle') {
      return {
        ...base,
        label: rule.label || `${rule.bundleAQty} ${rule.bundleAName} + ${rule.bundleBQty} ${rule.bundleBName}`,
        bundleItems: [
          {
            nameContains: rule.bundleAName.trim(),
            qty: parseFloat(rule.bundleAQty) || 0,
            unit: 'package' as const,
          },
          {
            nameContains: rule.bundleBName.trim(),
            qty: parseFloat(rule.bundleBQty) || 0,
            unit: 'package' as const,
          },
        ].filter((b) => b.nameContains && b.qty > 0),
      };
    }
    if (rule.type === 'volume_kg') return { ...base, minKg: parseFloat(rule.minKg) || 0 };
    if (rule.type === 'volume_amount')
      return { ...base, minAmount: parseAmount(rule.minAmount) || 0 };
    if (rule.type === 'loyalty')
      return {
        ...base,
        minInvoiceCount: parseFloat(rule.minInvoiceCount) || undefined,
        minMonthKg: parseFloat(rule.minMonthKg) || undefined,
      };
    if (rule.type === 'free_gift')
      return {
        ...base,
        discountPercent: percent,
        label:
          rule.label ||
          `اشانتیون: ${rule.triggerQty} ${rule.triggerName} → ${rule.giftQty} ${rule.giftName}`,
        triggerNameContains: rule.triggerName.trim(),
        triggerQty: parseFloat(rule.triggerQty) || 0,
        triggerUnit: 'package' as const,
        giftProductName: rule.giftName.trim(),
        giftQty: parseFloat(rule.giftQty) || 1,
        giftUnit: 'package' as const,
      };
    return base;
  };

  const create = async () => {
    if (!name.trim()) {
      setToast({ open: true, msg: 'نام جشنواره را وارد کن', color: 'danger' });
      return;
    }
    setLoading(true);
    try {
      await wsClient.request('campaign.create', {
        name,
        description,
        active,
        forMarketers,
        targetLoyaltyTiers: goldOnly ? ['gold'] : [],
        rules: [buildRulePayload()],
        suggestedInvoice: {
          title: suggestTitle || name,
          note: suggestNote || undefined,
          lines: suggestLines
            .filter((l) => l.productName.trim() && parseFloat(l.qty) > 0)
            .map((l) => ({
              productName: l.productName.trim(),
              qty: parseFloat(l.qty) || 0,
              unit: l.unit,
            })),
        },
      });
      setToast({ open: true, msg: 'جشنواره ثبت شد — برای بازاریاب‌ها فعال است', color: 'success' });
      setRule(emptyRule());
      setGoldOnly(false);
      await load();
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>جشنواره / تخفیف فروش</IonTitle>
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
          <div className="ios-glass-card">
            <div className="ios-section-title" style={{ marginTop: 0 }}>
              جشنواره جدید
            </div>
            <p className="hint">
              مثل شرکت‌های پخش: اشانتیون کارتن، تخفیف حجمی، پکیج ترکیبی — روی فاکتور فروش خودکار پیشنهاد
              می‌شود
            </p>
            <div className="chip-row" style={{ marginBottom: 8 }}>
              {MARKETING_PRESETS.map((p) => (
                <IonChip
                  key={p.name}
                  className="ios-chip"
                  onClick={() => {
                    const applied = p.apply();
                    setName(applied.name);
                    setDescription(applied.description);
                    setRule(applied.rule);
                  }}
                >
                  {p.name}
                </IonChip>
              ))}
            </div>
            <IonItem>
              <IonLabel position="stacked">نام</IonLabel>
              <IonInput value={name} onIonInput={(e) => setName(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">توضیح</IonLabel>
              <IonInput value={description} onIonInput={(e) => setDescription(e.detail.value || '')} />
            </IonItem>
            <div className="ios-row" style={{ padding: '8px 0' }}>
              <span>فعال</span>
              <IonToggle checked={active} onIonChange={(e) => setActive(e.detail.checked)} />
            </div>
            <div className="ios-row" style={{ padding: '8px 0' }}>
              <span>نمایش به بازاریاب</span>
              <IonToggle checked={forMarketers} onIonChange={(e) => setForMarketers(e.detail.checked)} />
            </div>
            <div className="ios-row" style={{ padding: '8px 0' }}>
              <span>فقط مشتریان طلایی (≥۵ تن/ماه)</span>
              <IonToggle checked={goldOnly} onIonChange={(e) => setGoldOnly(e.detail.checked)} />
            </div>
            {goldOnly && (
              <p className="hint" style={{ marginTop: 0 }}>
                این طرح فقط وقتی مشتری طلایی انتخاب شده باشد در فروش پیشنهاد می‌شود
              </p>
            )}

            <div className="ios-section-title">قانون تخفیف</div>
            <div className="chip-row">
              {RULE_TYPES.map((t) => (
                <IonChip
                  key={t.value}
                  className={rule.type === t.value ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setRule({ ...rule, type: t.value })}
                >
                  {t.label}
                </IonChip>
              ))}
            </div>
            <IonItem>
              <IonLabel position="stacked">برچسب دکمه (اختیاری)</IonLabel>
              <IonInput
                value={rule.label}
                placeholder="مثلاً تخفیف نقدی جشنواره"
                onIonInput={(e) => setRule({ ...rule, label: e.detail.value || '' })}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">
                {rule.type === 'free_gift' ? 'درصد تخفیف اضافه (اختیاری، معمولاً ۰)' : 'درصد تخفیف'}
              </IonLabel>
              <IonInput
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={rule.discountPercent}
                onIonInput={(e) =>
                  setRule({
                    ...rule,
                    discountPercent: sanitizeNumberInput(e.detail.value || '', { decimal: true }),
                  })
                }
              />
            </IonItem>

            {rule.type === 'free_gift' && (
              <>
                <IonItem>
                  <IonLabel position="stacked">اگر مشتری بخرد (نام محصول شامل)</IonLabel>
                  <IonInput
                    value={rule.triggerName}
                    placeholder="مثلاً کارتن"
                    onIonInput={(e) => setRule({ ...rule, triggerName: e.detail.value || '' })}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">حداقل تعداد بسته / کارتن</IonLabel>
                  <IonInput
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={rule.triggerQty}
                    onIonInput={(e) =>
                      setRule({
                        ...rule,
                        triggerQty: sanitizeNumberInput(e.detail.value || ''),
                      })
                    }
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">اشانتیون / هدیه (نام محصول)</IonLabel>
                  <IonInput
                    value={rule.giftName}
                    placeholder="مثلاً کارتن"
                    onIonInput={(e) => setRule({ ...rule, giftName: e.detail.value || '' })}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">تعداد اشانتیون</IonLabel>
                  <IonInput
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={rule.giftQty}
                    onIonInput={(e) =>
                      setRule({
                        ...rule,
                        giftQty: sanitizeNumberInput(e.detail.value || ''),
                      })
                    }
                  />
                </IonItem>
                <p className="hint convert-hint">
                  مثال: ۱۰ کارتن بخر → ۱ کارتن رایگان به فاکتور پیشنهاد می‌شود
                </p>
              </>
            )}

            {rule.type === 'bundle' && (
              <>
                <IonItem>
                  <IonLabel position="stacked">محصول ۱ (نام شامل)</IonLabel>
                  <IonInput
                    value={rule.bundleAName}
                    onIonInput={(e) => setRule({ ...rule, bundleAName: e.detail.value || '' })}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">تعداد بسته محصول ۱</IonLabel>
                  <IonInput
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={rule.bundleAQty}
                    onIonInput={(e) =>
                      setRule({ ...rule, bundleAQty: sanitizeNumberInput(e.detail.value || '') })
                    }
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">محصول ۲ (نام شامل)</IonLabel>
                  <IonInput
                    value={rule.bundleBName}
                    onIonInput={(e) => setRule({ ...rule, bundleBName: e.detail.value || '' })}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">تعداد بسته محصول ۲</IonLabel>
                  <IonInput
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={rule.bundleBQty}
                    onIonInput={(e) =>
                      setRule({ ...rule, bundleBQty: sanitizeNumberInput(e.detail.value || '') })
                    }
                  />
                </IonItem>
              </>
            )}
            {rule.type === 'volume_kg' && (
              <IonItem>
                <IonLabel position="stacked">حداقل کیلو</IonLabel>
                <IonInput
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={rule.minKg}
                  onIonInput={(e) =>
                    setRule({ ...rule, minKg: sanitizeNumberInput(e.detail.value || '', { decimal: true }) })
                  }
                />
              </IonItem>
            )}
            {rule.type === 'volume_amount' && (
              <MoneyInput
                label="حداقل مبلغ سبد (تومان)"
                value={formatMoneyInput(rule.minAmount)}
                onChange={(v) => setRule({ ...rule, minAmount: String(parseAmount(v) || 0) })}
              />
            )}
            {rule.type === 'loyalty' && (
              <>
                <IonItem>
                  <IonLabel position="stacked">حداقل تعداد فاکتور قبلی</IonLabel>
                  <IonInput
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={rule.minInvoiceCount}
                    onIonInput={(e) =>
                      setRule({
                        ...rule,
                        minInvoiceCount: sanitizeNumberInput(e.detail.value || ''),
                      })
                    }
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">حداقل کیلو در ماه</IonLabel>
                  <IonInput
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={rule.minMonthKg}
                    onIonInput={(e) =>
                      setRule({
                        ...rule,
                        minMonthKg: sanitizeNumberInput(e.detail.value || '', { decimal: true }),
                      })
                    }
                  />
                </IonItem>
              </>
            )}

            <div className="ios-section-title">فاکتور پیشنهادی (برای دکمه در سبد)</div>
            <IonItem>
              <IonLabel position="stacked">عنوان دکمه</IonLabel>
              <IonInput value={suggestTitle} onIonInput={(e) => setSuggestTitle(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">یادداشت</IonLabel>
              <IonInput value={suggestNote} onIonInput={(e) => setSuggestNote(e.detail.value || '')} />
            </IonItem>
            {suggestLines.map((l, i) => (
              <div key={i} className="ios-glass-card" style={{ marginTop: 8 }}>
                <IonItem lines="none">
                  <IonLabel position="stacked">نام محصول</IonLabel>
                  <IonInput
                    value={l.productName}
                    onIonInput={(e) => {
                      const next = [...suggestLines];
                      next[i] = { ...l, productName: e.detail.value || '' };
                      setSuggestLines(next);
                    }}
                  />
                </IonItem>
                <IonItem lines="none">
                  <IonLabel position="stacked">تعداد</IonLabel>
                  <IonInput
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={l.qty}
                    onIonInput={(e) => {
                      const next = [...suggestLines];
                      next[i] = { ...l, qty: sanitizeNumberInput(e.detail.value || '', { decimal: true }) };
                      setSuggestLines(next);
                    }}
                  />
                </IonItem>
                <div className="chip-row">
                  <IonChip
                    className={l.unit === 'package' ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => {
                      const next = [...suggestLines];
                      next[i] = { ...l, unit: 'package' };
                      setSuggestLines(next);
                    }}
                  >
                    بسته
                  </IonChip>
                  <IonChip
                    className={l.unit === 'kg' ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => {
                      const next = [...suggestLines];
                      next[i] = { ...l, unit: 'kg' };
                      setSuggestLines(next);
                    }}
                  >
                    کیلو
                  </IonChip>
                  <IonButton
                    size="small"
                    fill="clear"
                    color="danger"
                    onClick={() => setSuggestLines(suggestLines.filter((_, j) => j !== i))}
                  >
                    <IonIcon icon={trashOutline} />
                  </IonButton>
                </div>
              </div>
            ))}
            <IonButton
              size="small"
              fill="outline"
              onClick={() => setSuggestLines([...suggestLines, { productName: '', qty: '1', unit: 'package' }])}
            >
              <IonIcon slot="start" icon={addOutline} />
              قلم پیشنهادی
            </IonButton>

            <IonButton
              expand="block"
              className="ios-primary-btn ion-margin-top"
              disabled={loading}
              onClick={() => void create()}
            >
              <IonIcon slot="start" icon={checkmarkCircleOutline} />
              ثبت جشنواره
            </IonButton>
          </div>

          <div className="ios-section-title">جشنواره‌های فعال / قبلی</div>
          {list.length === 0 && <p className="hint">هنوز جشنواره‌ای نیست</p>}
          {list.map((c) => (
            <div key={c._id} className="ios-glass-card">
              <div className="ios-row">
                <div>
                  <strong>{c.name}</strong>
                  <div className="ios-caption">
                    {c.active ? 'فعال' : 'خاموش'}
                    {c.forMarketers ? ' · بازاریاب' : ''}
                    {(c.targetLoyaltyTiers || []).includes('gold') ? ' · فقط طلایی' : ''}
                  </div>
                </div>
                <IonButton
                  size="small"
                  fill="clear"
                  color="danger"
                  onClick={() =>
                    void wsClient
                      .request('campaign.delete', { id: c._id })
                      .then(load)
                      .catch((e) =>
                        setToast({
                          open: true,
                          msg: e instanceof Error ? e.message : 'حذف نشد',
                          color: 'danger',
                        })
                      )
                  }
                >
                  حذف
                </IonButton>
              </div>
              {c.description && <p className="hint">{c.description}</p>}
              {(c.rules || []).map((r, i) => (
                <div key={i} className="hint convert-hint">
                  • {r.label || r.type} · {r.discountPercent}٪
                </div>
              ))}
              {c.suggestedInvoice?.title && (
                <div className="hint">پیشنهاد سبد: {c.suggestedInvoice.title}</div>
              )}
              <IonButton
                size="small"
                fill="outline"
                onClick={() =>
                  void wsClient
                    .request('campaign.update', { id: c._id, active: !c.active })
                    .then(load)
                }
              >
                {c.active ? 'خاموش کردن' : 'روشن کردن'}
              </IonButton>
            </div>
          ))}
        </div>

        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2400}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default Campaigns;
