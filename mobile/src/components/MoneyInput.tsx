import { IonInput, IonItem, IonLabel, IonNote } from '@ionic/react';
import { formatMoneyInput, parseAmount } from '../utils/format';

interface Props {
  label?: string;
  value: string;
  /** formatted همیشه آرگومان اول است */
  onChange: (formatted: string, numeric?: number | null) => void;
  placeholder?: string;
  lines?: 'full' | 'none' | 'inset';
}

/** فیلد مبلغ تومان با جداکننده سه‌رقمی + کیبورد عددی + تبدیل فارسی→انگلیسی */
export const MoneyInput: React.FC<Props> = ({
  label = 'مبلغ (تومان)',
  value,
  onChange,
  placeholder = 'مثلاً ۱۵۰۰۰۰۰',
  lines = 'full',
}) => {
  const numeric = parseAmount(value);

  return (
    <IonItem lines={lines}>
      {label ? <IonLabel position="stacked">{label}</IonLabel> : null}
      <IonInput
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        enterkeyhint="done"
        autocomplete="off"
        value={value}
        placeholder={placeholder}
        onIonInput={(e) => {
          const formatted = formatMoneyInput(e.detail.value || '');
          onChange(formatted, parseAmount(formatted));
        }}
      />
      {numeric != null && numeric > 0 && (
        <IonNote slot="helper" className="money-note">
          {numeric.toLocaleString('fa-IR')} تومان
        </IonNote>
      )}
    </IonItem>
  );
};

export default MoneyInput;
