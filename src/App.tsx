import React, { useEffect } from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import { Box } from '@chakra-ui/react';
import HomePage from './pages/HomePage';
import DocumentsPage from './pages/DocumentsPage';
import QuotePage from './pages/QuotePage';
import { QuotePreviewPage } from './pages/QuotePreviewPage';
import CompanySettingsPage from './pages/CompanySettingsPage';
import LoginPage from './pages/LoginPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import BottomNav from './components/BottomNav/BottomNav';
import { Header } from './components/Header';
// import { UpdateNotification } from './components/UpdateNotification'; // Disabled
import { registerServiceWorker } from './utils/pwa';
import { PrivateRoute } from './components/PrivateRoute';
import { useCompanySync } from './hooks/useCompanySync';
import { useAppStore } from './store';

const App: React.FC = () => {
  // Initialize database sync for company info (syncs across devices)
  useCompanySync(true); // true = enable real-time updates

  const { restoreActiveProposals, loadRecentProposals } = useAppStore();

  useEffect(() => {
    // Register service worker for PWA support (now enabled in all environments)
    registerServiceWorker().catch(err => {
      console.error('Failed to register service worker:', err);
    });

    // Restore active proposals from IndexedDB/localStorage on every app startup
    const restore = async () => {
      await loadRecentProposals();
      await restoreActiveProposals();
    };
    restore();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ErrorBoundary>
      <Box minH="100vh" bg="white">
        {/* Update Notification Component - Disabled */}
        {/* <UpdateNotification /> */}
        
        <Router>
          <Route
            render={({ location }) => {
              // Don't show app header on login or quote preview (preview has its own toolbar)
              // Pages with their own top nav (flow headers)
              const hideHeader =
                location.pathname === '/login' ||
                location.pathname === '/' ||
                location.pathname === '/quote' ||
                location.pathname === '/preview' ||
                location.pathname === '/company-settings';
              const hideBottomNav =
                location.pathname === '/login' ||
                location.pathname === '/preview';
              return (
                <>
                  {!hideHeader && <Header />}
                  <Switch>
                    {/* Auth Routes - Public */}
                    <Route exact path="/login" component={LoginPage} />
                    <Route exact path="/unauthorized" component={UnauthorizedPage} />
                    
                    {/* Protected Routes - Requires Authentication */}
                    <PrivateRoute exact path="/" component={HomePage} />
                    <PrivateRoute exact path="/documents" component={DocumentsPage} />
                    <PrivateRoute exact path="/quote" component={QuotePage} />
                    <PrivateRoute exact path="/preview" component={QuotePreviewPage} />
                    <PrivateRoute exact path="/company-settings" component={CompanySettingsPage} />
                    
                    {/* Fallback */}
                    <Route render={() => <Redirect to="/" />} />
                  </Switch>
                  {!hideBottomNav && <BottomNav />}
                </>
              );
            }}
          />
        </Router>
      </Box>
    </ErrorBoundary>
  );
};

export default App;
