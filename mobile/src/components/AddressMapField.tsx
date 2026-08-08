import { useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonModal,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { mapOutline, checkmarkOutline } from 'ionicons/icons';
import { LocationPicker } from './LocationPicker';

type Props = {
  label?: string;
  placeholder?: string;
  address: string;
  onAddressChange: (address: string) => void;
  lat?: number | null;
  lng?: number | null;
  onLocationChange: (pos: { lat: number; lng: number; address?: string }) => void;
  /** نمایش مختصر وضعیت موقعیت زیر فیلد */
  showPinHint?: boolean;
};

/**
 * فیلد آدرس + دکمه نقشه کنارش؛ انتخاب موقعیت در مودال بزرگ
 */
export const AddressMapField: React.FC<Props> = ({
  label = 'آدرس',
  placeholder = 'آدرس ارسال / خیابان…',
  address,
  onAddressChange,
  lat,
  lng,
  onLocationChange,
  showPinHint = true,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="address-map-field">
      <div className="address-map-row">
        <IonItem lines="full" className="address-map-input">
          <IonLabel position="stacked">{label}</IonLabel>
          <IonInput
            value={address}
            placeholder={placeholder}
            onIonInput={(e) => onAddressChange(e.detail.value || '')}
          />
        </IonItem>
        <button
          type="button"
          className={`address-map-btn${lat != null && lng != null ? ' has-pin' : ''}`}
          onClick={() => setOpen(true)}
          aria-label="انتخاب روی نقشه"
        >
          <IonIcon icon={mapOutline} />
          <span>نقشه</span>
        </button>
      </div>
      {showPinHint && lat != null && lng != null && (
        <p className="hint convert-hint address-map-pin-hint">📍 موقعیت روی نقشه ثبت شده</p>
      )}

      <IonModal
        isOpen={open}
        onDidDismiss={() => setOpen(false)}
        className="address-map-modal"
      >
        <IonHeader>
          <IonToolbar>
            <IonTitle>انتخاب موقعیت</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setOpen(false)}>بستن</IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="address-map-modal-content">
          <div className="address-map-modal-body">
            <p className="hint" style={{ marginTop: 0 }}>
              روی نقشه بزن یا نقطه را بکش؛ آدرس خیابان خودکار پر می‌شود.
            </p>
            {open && (
              <LocationPicker
                key={`${lat ?? 'x'}-${lng ?? 'y'}-${open ? '1' : '0'}`}
                lat={lat}
                lng={lng}
                address={address}
                height={Math.max(
                  360,
                  Math.round((typeof window !== 'undefined' ? window.innerHeight : 700) * 0.58)
                )}
                onChange={(pos) => {
                  onLocationChange(pos);
                  if (pos.address) onAddressChange(pos.address);
                }}
              />
            )}
            {address && (
              <p className="hint convert-hint" style={{ marginTop: 10 }}>
                آدرس انتخاب‌شده: {address}
              </p>
            )}
            <IonButton
              expand="block"
              className="ios-primary-btn"
              style={{ marginTop: 12 }}
              onClick={() => setOpen(false)}
            >
              <IonIcon slot="start" icon={checkmarkOutline} />
              تأیید و بستن
            </IonButton>
          </div>
        </IonContent>
      </IonModal>
    </div>
  );
};

export default AddressMapField;
