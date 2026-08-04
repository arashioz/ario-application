import { IonInput, IonItem, IonLabel } from '@ionic/react';
import { normalizePhone, sanitizeNumberInput } from '../utils/format';

type Mode = 'int' | 'decimal' | 'phone' | 'tel';

interface Props {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  lines?: 'full' | 'none' | 'inset';
  /** int = فقط رقم · decimal = اعشار · phone/tel = موبایل */
  mode?: Mode;
  maxLen?: number;
  disabled?: boolean;
  className?: string;
  /** اگر true فقط IonInput بدون IonItem */
  bare?: boolean;
}

/**
 * فیلد عدد با کیبورد عددی + تبدیل خودکار ارقام فارسی/عربی به انگلیسی
 */
export const DigitInput: React.FC<Props> = ({
  label,
  value,
  onChange,
  placeholder,
  lines = 'full',
  mode = 'int',
  maxLen,
  disabled,
  className,
  bare,
}) => {
  // numeric + pattern روی iOS کیبورد عدد می‌آورد؛ tel گاهی کاراکتر اضافه دارد
  const inputMode = mode === 'decimal' ? 'decimal' : 'numeric';

  const handle = (raw: string) => {
    if (mode === 'phone' || mode === 'tel') {
      onChange(normalizePhone(raw).slice(0, maxLen || 15));
      return;
    }
    onChange(sanitizeNumberInput(raw, { decimal: mode === 'decimal', maxLen }));
  };

  const field = (
    <IonInput
      className={className}
      type="text"
      inputMode={inputMode}
      pattern={mode === 'decimal' ? '[0-9]*[.]?[0-9]*' : '[0-9]*'}
      enterkeyhint="done"
      autocomplete={mode === 'phone' || mode === 'tel' ? 'tel' : 'off'}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onIonInput={(e) => handle(e.detail.value || '')}
    />
  );

  if (bare || !label) return field;

  return (
    <IonItem lines={lines}>
      <IonLabel position="stacked">{label}</IonLabel>
      {field}
    </IonItem>
  );
};

export default DigitInput;
