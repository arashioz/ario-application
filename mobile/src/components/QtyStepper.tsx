import { IonButton, IonIcon, IonInput } from '@ionic/react';
import { addOutline, removeOutline } from 'ionicons/icons';
import { sanitizeNumberInput, toEnglishDigits } from '../utils/format';

type Props = {
  value: string;
  onChange: (v: string) => void;
  min?: number;
  stepExtra?: number;
  /** اجازه مقدار منفی (مثلاً کاهش موجودی) */
  allowNegative?: boolean;
};

function sanitizeQty(text: string, allowNegative?: boolean): string {
  if (!allowNegative) {
    return sanitizeNumberInput(text, { decimal: true });
  }
  let s = toEnglishDigits(text || '');
  const neg = s.trim().startsWith('-');
  s = s.replace(/٫/g, '.').replace(/,/g, '.').replace(/٬/g, '');
  s = s.replace(/[^\d.]/g, '');
  const parts = s.split('.');
  if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');
  return neg ? `-${s}` : s;
}

/** کنترل کم/زیاد مقدار — مشترک صفحه فروش و ویرایش فاکتور */
export const QtyStepper: React.FC<Props> = ({
  value,
  onChange,
  min = 0,
  stepExtra = 5,
  allowNegative = false,
}) => {
  const n = parseFloat(value) || 0;
  return (
    <div className="qty-stepper">
      <IonButton
        fill="outline"
        size="small"
        onClick={() => onChange(String(Math.max(min, n - 1)))}
      >
        <IonIcon icon={removeOutline} />
      </IonButton>
      <IonInput
        type="text"
        inputMode="decimal"
        className="qty-input"
        pattern={undefined}
        value={value}
        placeholder="0.2"
        onIonInput={(e) => onChange(sanitizeQty(e.detail.value || '', allowNegative))}
      />
      <IonButton fill="outline" size="small" onClick={() => onChange(String(n + 1))}>
        <IonIcon icon={addOutline} />
      </IonButton>
      <IonButton
        fill="solid"
        size="small"
        className="qty-plus5"
        onClick={() => onChange(String(n + stepExtra))}
      >
        +{stepExtra.toLocaleString('fa-IR')}
      </IonButton>
    </div>
  );
};

export default QtyStepper;
