import { useState } from 'react';
import { Calendar, DateObject } from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonLabel,
  IonModal,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { todayIso } from '../utils/format';

interface Props {
  label?: string;
  value: string;
  onChange: (iso: string) => void;
}

function toIsoFromDateObject(d: DateObject): string {
  const g = d.toDate();
  const y = g.getFullYear();
  const m = String(g.getMonth() + 1).padStart(2, '0');
  const day = String(g.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** انتخابگر تاریخ شمسی — کلیک → مودال تقویم؛ کیبورد باز نمی‌شود */
export function PersianDateField({ label = 'تاریخ', value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const selected = value
    ? new DateObject({ date: new Date(value + 'T12:00:00'), calendar: persian, locale: persian_fa })
    : new DateObject({ calendar: persian, locale: persian_fa });

  const displayFa = value
    ? new Date(value + 'T12:00:00').toLocaleDateString('fa-IR')
    : 'انتخاب تاریخ';

  return (
    <div className="date-field">
      {label ? <IonLabel className="date-label">{label}</IonLabel> : null}
      <div className="date-cards">
        <button
          type="button"
          className={`date-card ${!value || value === todayIso() ? 'active' : ''}`}
          onClick={() => onChange(todayIso())}
        >
          امروز
        </button>
        <button
          type="button"
          className="date-picker-btn"
          onClick={() => setOpen(true)}
        >
          <span className="date-picker-btn-label">تقویم</span>
          <span className="date-picker-btn-value">{displayFa}</span>
        </button>
      </div>
      <div className="date-hint">{value ? displayFa : 'تاریخی انتخاب نشده'}</div>

      <IonModal isOpen={open} onDidDismiss={() => setOpen(false)} initialBreakpoint={0.55} breakpoints={[0, 0.55, 0.75]}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>{label}</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setOpen(false)}>تأیید</IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <div className="date-modal-cal">
            <Calendar
              value={selected}
              onChange={(d: DateObject | DateObject[] | null) => {
                if (!d || Array.isArray(d)) return;
                onChange(toIsoFromDateObject(d));
              }}
              calendar={persian}
              locale={persian_fa}
            />
          </div>
          <div className="chip-row" style={{ marginTop: 12, justifyContent: 'center' }}>
            <button type="button" className="date-card active" onClick={() => onChange(todayIso())}>
              امروز
            </button>
          </div>
        </IonContent>
      </IonModal>
    </div>
  );
}

export default PersianDateField;
