import React, { useEffect } from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import { Box } from '@chakra-ui/react';
import HomePage from './pages/HomePage';
import QuotePage from './pages/QuotePage';
import { QuotePreviewPage } from './pages/QuotePreviewPage';
import LoginPage from './pages/LoginPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import BottomNav from './components/BottomNav/BottomNav';
import { Header } from './components/Header';
import { registerServiceWorker } from './utils/pwa';
import { PrivateRoute } from './components/PrivateRoute';
import { useCompanySync } from './hooks/useCompanySync';

const App: React.FC = () => {
  // Initialize database sync for company info (syncs across devices)
  useCompanySync(true); // true = enable real-time updates

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
      <Box minH="100vh" bg="white">
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
