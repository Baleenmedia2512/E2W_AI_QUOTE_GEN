import React, { useEffect } from 'react';
import { IonApp, IonRouterOutlet, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Route, Redirect } from 'react-router-dom';
import HomePage from './pages/HomePage';
import QuotePage from './pages/QuotePage';
import { QuotePreviewPage } from './pages/QuotePreviewPage';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { registerServiceWorker } from './utils/pwa';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

setupIonicReact();

const App: React.FC = () => {
  useEffect(() => {
    // Register service worker for PWA support
    if (process.env.NODE_ENV === 'production') {
      registerServiceWorker().catch(err => {
        console.error('Failed to register service worker:', err);
      });
    }
  }, []);

  return (
    <ErrorBoundary>
      <IonApp>
        <IonReactRouter>
          <IonRouterOutlet>
            <Route exact path="/" component={HomePage} />
            <Route exact path="/quote" component={QuotePage} />
            <Route exact path="/preview" component={QuotePreviewPage} />
            <Route render={() => <Redirect to="/" />} />
          </IonRouterOutlet>
        </IonReactRouter>
      </IonApp>
    </ErrorBoundary>
  );
};

export default App;
