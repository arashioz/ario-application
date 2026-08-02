import { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { IonPage, IonContent, IonSpinner } from '@ionic/react';

/** مسیر قدیمی — هدایت به مدیریت محصولات یکپارچه */
const Categories: React.FC = () => {
  const history = useHistory();
  useEffect(() => {
    history.replace('/catalog-admin');
  }, [history]);

  return (
    <IonPage>
      <IonContent className="ion-padding" style={{ textAlign: 'center', paddingTop: 80 }}>
        <IonSpinner name="crescent" />
        <p className="hint">انتقال به مدیریت محصولات…</p>
      </IonContent>
    </IonPage>
  );
};

export default Categories;
