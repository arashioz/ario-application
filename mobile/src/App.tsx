import { useEffect, useState } from 'react';
import { Redirect, Route, Switch } from 'react-router-dom';
import {
  IonApp,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  setupIonicReact,
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import {
  homeOutline,
  cartOutline,
  receiptOutline,
  chatbubbleEllipsesOutline,
  gridOutline,
  fileTrayFullOutline,
  bicycleOutline,
} from 'ionicons/icons';

import { AuthProvider, useAuth } from './auth/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Purchase from './pages/Purchase';
import Sale from './pages/Sale';
import Expense from './pages/Expense';
import Chat from './pages/Chat';
import Debtors from './pages/Debtors';
import History from './pages/History';
import Customers from './pages/Customers';
import Categories from './pages/Categories';
import Targets from './pages/Targets';
import Campaigns from './pages/Campaigns';
import More from './pages/More';
import Orders from './pages/Orders';
import Invoices from './pages/Invoices';
import CustomersMap from './pages/CustomersMap';
import Checks from './pages/Checks';
import DriverJobs from './pages/DriverJobs';
import DriversMap from './pages/DriversMap';
import DriverPayouts from './pages/DriverPayouts';
import CatalogAdmin from './pages/CatalogAdmin';
import PublicCatalog from './pages/PublicCatalog';
import AppSettings from './pages/AppSettings';
import Register from './pages/Register';
import PartnerApprovals from './pages/PartnerApprovals';
import PlatformSettings from './pages/PlatformSettings';
import VolumeOrders from './pages/VolumeOrders';
import MyWallet from './pages/MyWallet';
import ProductAnalytics from './pages/ProductAnalytics';
import { wsClient } from './api/ws';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';
import './theme/variables.css';

setupIonicReact({ mode: 'ios' });

const DriverApp: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  if (!enabled) {
    return (
      <IonApp>
        <div className="ion-padding" style={{ marginTop: 80, textAlign: 'center' }}>
          <h2>پنل راننده خاموش است</h2>
          <p>مدیر از تنظیمات اپ این بخش را غیرفعال کرده.</p>
        </div>
      </IonApp>
    );
  }
  return (
  <IonTabs>
    <IonRouterOutlet>
      <Route exact path="/driver" component={DriverJobs} />
      <Route exact path="/dashboard">
        <Redirect to="/driver" />
      </Route>
      <Route exact path="/">
        <Redirect to="/driver" />
      </Route>
    </IonRouterOutlet>
    <IonTabBar slot="bottom" className="main-tabs">
      <IonTabButton tab="driver" href="/driver">
        <IonIcon icon={bicycleOutline} />
        <IonLabel>ارسال‌ها</IonLabel>
      </IonTabButton>
    </IonTabBar>
  </IonTabs>
  );
};

const AuthedApp: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const [driverPanelEnabled, setDriverPanelEnabled] = useState(true);
  const [marketerPanelEnabled, setMarketerPanelEnabled] = useState(true);

  useEffect(() => {
    if (user) wsClient.connect();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const loadFlags = () => {
      void wsClient
        .request<{ driverPanelEnabled?: boolean; marketerPanelEnabled?: boolean }>('settings.get')
        .then((s) => {
          setDriverPanelEnabled(s.driverPanelEnabled !== false);
          setMarketerPanelEnabled(s.marketerPanelEnabled !== false);
        })
        .catch(() => undefined);
    };
    loadFlags();
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === 'settings') loadFlags();
    });
    return unsub;
  }, [user]);

  if (!user) return <Login />;
  if (user.role === 'driver') return <DriverApp enabled={driverPanelEnabled} />;
  if (user.role === 'marketer' && !marketerPanelEnabled) {
    return (
      <IonApp>
        <div className="ion-padding" style={{ marginTop: 80, textAlign: 'center' }}>
          <h2>پنل بازاریاب خاموش است</h2>
          <p>مدیر از تنظیمات اپ این بخش را غیرفعال کرده.</p>
        </div>
      </IonApp>
    );
  }

  return (
    <IonTabs>
      <IonRouterOutlet>
        <Route exact path="/dashboard" component={Dashboard} />
        <Route exact path="/purchase" component={Purchase} />
        <Route exact path="/sale" component={Sale} />
        <Route exact path="/expense" component={Expense} />
        <Route exact path="/chat" component={Chat} />
        <Route exact path="/debtors" component={Debtors} />
        <Route exact path="/history" component={History} />
        <Route exact path="/customers" component={Customers} />
        <Route exact path="/categories" component={Categories} />
        <Route exact path="/targets" component={Targets} />
        <Route exact path="/campaigns" component={Campaigns} />
        <Route exact path="/catalog-admin" component={CatalogAdmin} />
        <Route exact path="/app-settings" component={AppSettings} />
        <Route exact path="/partner-approvals" component={PartnerApprovals} />
        <Route exact path="/platform-settings" component={PlatformSettings} />
        <Route exact path="/volume-orders" component={VolumeOrders} />
        <Route exact path="/my-wallet" component={MyWallet} />
        <Route exact path="/product-analytics/:id" component={ProductAnalytics} />
        <Route exact path="/more" component={More} />
        <Route exact path="/invoices" component={Invoices} />
        <Route exact path="/customers-map" component={CustomersMap} />
        <Route exact path="/orders" component={Orders} />
        <Route exact path="/checks" component={Checks} />
        <Route exact path="/drivers-map" component={DriversMap} />
        <Route exact path="/driver-payouts" component={DriverPayouts} />
        <Route exact path="/driver" component={DriverJobs} />
        <Route exact path="/">
          <Redirect to="/dashboard" />
        </Route>
      </IonRouterOutlet>

      <IonTabBar slot="bottom" className="main-tabs">
        <IonTabButton tab="dashboard" href="/dashboard">
          <IonIcon icon={homeOutline} />
          <IonLabel>خانه</IonLabel>
        </IonTabButton>
        {isAdmin && (
          <IonTabButton tab="purchase" href="/purchase">
            <IonIcon icon={cartOutline} />
            <IonLabel>خرید</IonLabel>
          </IonTabButton>
        )}
        <IonTabButton tab="sale" href="/sale">
          <IonIcon icon={receiptOutline} />
          <IonLabel>فروش</IonLabel>
        </IonTabButton>
        <IonTabButton tab="orders" href="/orders">
          <IonIcon icon={fileTrayFullOutline} />
          <IonLabel>سفارش</IonLabel>
        </IonTabButton>
        {!isAdmin && (
          <IonTabButton tab="chat" href="/chat">
            <IonIcon icon={chatbubbleEllipsesOutline} />
            <IonLabel>دستیار</IonLabel>
          </IonTabButton>
        )}
        <IonTabButton tab="more" href="/more">
          <IonIcon icon={gridOutline} />
          <IonLabel>بیشتر</IonLabel>
        </IonTabButton>
      </IonTabBar>
    </IonTabs>
  );
};

const App: React.FC = () => (
  <IonApp>
    <AuthProvider>
      <IonReactRouter>
        <Switch>
          <Route exact path="/catalog" component={PublicCatalog} />
          <Route exact path="/register" component={Register} />
          <Route path="/" component={AuthedApp} />
        </Switch>
      </IonReactRouter>
    </AuthProvider>
  </IonApp>
);

export default App;
