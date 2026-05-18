import { Box } from '@chakra-ui/react';
import React, { useEffect } from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';

import BottomNav from './components/BottomNav/BottomNav';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { Header } from './components/Header';
import { PrivateRoute } from './components/PrivateRoute';
import { useCityServiceRegistry } from './hooks/useCityServiceRegistry';
import { useCompanySync } from './hooks/useCompanySync';
import DocumentsPage from './pages/DocumentsPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import QuotePage from './pages/QuotePage';
import { QuotePreviewPage } from './pages/QuotePreviewPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
// import { UpdateNotification } from './components/UpdateNotification'; // Disabled
import { useAppStore } from './store';
import { registerServiceWorker } from './utils/pwa';

const App: React.FC = () => {
  // Initialize database sync for company info (syncs across devices)
  useCompanySync(true); // true = enable real-time updates
  // Build city service registry in background whenever active proposals change
  useCityServiceRegistry();

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
              // Don't show header on login page
              const hideHeader = location.pathname === '/login';
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
                    
                    {/* Fallback */}
                    <Route render={() => <Redirect to="/" />} />
                  </Switch>
                  <BottomNav />
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
