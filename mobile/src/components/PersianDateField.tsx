import DatePicker, { DateObject } from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import { IonLabel } from '@ionic/react';
import { todayIso } from '../utils/format';

interface Props {
  label?: string;
  value: string;
  onChange: (iso: string) => void;
}

/** انتخابگر تاریخ شمسی — کارت‌مانند */
export function PersianDateField({ label = 'تاریخ', value, onChange }: Props) {
  const display = value
    ? new DateObject(new Date(value + 'T12:00:00'))
    : new DateObject();

  return (
    <div className="date-field">
      <IonLabel className="date-label">{label}</IonLabel>
      <div className="date-cards">
        <button
          type="button"
          className={`date-card ${!value || value === todayIso() ? 'active' : ''}`}
          onClick={() => onChange(todayIso())}
        >
          امروز
        </button>
        <div className="date-picker-wrap">
          <DatePicker
            value={display}
            onChange={(d: DateObject | DateObject[] | null) => {
              if (!d || Array.isArray(d)) return;
              const g = d.toDate();
              const iso = g.toISOString().split('T')[0];
              onChange(iso);
            }}
            calendar={persian}
            locale={persian_fa}
            format="YYYY/MM/DD"
            inputClass="date-input"
            containerClassName="rmdp-rtl"
            calendarPosition="bottom-right"
          />
        </div>
      </div>
      <div className="date-hint">{value ? new Date(value + 'T12:00:00').toLocaleDateString('fa-IR') : '—'}</div>
    </div>
  );
}
