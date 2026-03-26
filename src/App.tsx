import React, { useEffect } from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import { Box } from '@chakra-ui/react';
import HomePage from './pages/HomePage';
import QuotePage from './pages/QuotePage';
import { QuotePreviewPage } from './pages/QuotePreviewPage';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import BottomNav from './components/BottomNav/BottomNav';
import { registerServiceWorker } from './utils/pwa';

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
      <Box minH="100vh" bg="white">
        <Router>
          <Switch>
            <Route exact path="/" component={HomePage} />
            <Route exact path="/quote" component={QuotePage} />
            <Route exact path="/preview" component={QuotePreviewPage} />
            <Route render={() => <Redirect to="/" />} />
          </Switch>
          <BottomNav />
        </Router>
      </Box>
    </ErrorBoundary>
  );
};

export default App;
