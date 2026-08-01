import { IonInput, IonItem, IonLabel, IonNote } from '@ionic/react';
import { formatMoneyInput, parseAmount } from '../utils/format';

interface Props {
  label?: string;
  value: string;
  onChange: (formatted: string, numeric: number | null) => void;
  placeholder?: string;
  lines?: 'full' | 'none' | 'inset';
}

/** فیلد مبلغ تومان با جداکننده سه‌رقمی */
export const MoneyInput: React.FC<Props> = ({
  label = 'مبلغ (تومان)',
  value,
  onChange,
  placeholder = 'مثلاً ۱٬۵۰۰٬۰۰۰',
  lines = 'full',
}) => {
  const numeric = parseAmount(value);

  return (
    <IonItem lines={lines}>
      <IonLabel position="stacked">{label}</IonLabel>
      <IonInput
        inputmode="numeric"
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
