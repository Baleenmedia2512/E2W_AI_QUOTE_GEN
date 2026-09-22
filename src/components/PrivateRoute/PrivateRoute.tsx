import React, { useEffect } from 'react';
import { Route, Redirect, RouteProps } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { authService } from '../../services/authService';
import { AuthUser } from '../../types/auth';

interface PrivateRouteProps extends RouteProps {
  component: React.ComponentType<any>;
  requiredRole?: string;
  requiredPermission?: string;
  authorize?: (user: AuthUser | null) => boolean;
}

/**
 * PrivateRoute wrapper component
 * Protects routes from unauthorized access
 *
 * Usage:
 * <PrivateRoute path="/admin" component={AdminPage} requiredRole="admin" />
 * <PrivateRoute path="/quotes" component={QuotesPage} requiredPermission="view_quotes" />
 */
export const PrivateRoute: React.FC<PrivateRouteProps> = ({
  component: Component,
  requiredRole,
  requiredPermission,
  authorize,
  ...rest
}) => {
  const { isAuthenticated, hasRole, hasPermission, user, logout } = useAuthStore();
  const sessionOk = authService.hasValidSessionToken();

  useEffect(() => {
    // Stale "logged in" UI without a usable email/session token → force re-login
    if (isAuthenticated && !sessionOk) {
      logout();
    }
  }, [isAuthenticated, sessionOk, logout]);

  return (
    <Route
      {...rest}
      render={(props) => {
        if (!isAuthenticated || !sessionOk) {
          return (
            <Redirect
              to={{
                pathname: '/login',
                state: { from: props.location.pathname },
              }}
            />
          );
        }

        if (requiredRole && !hasRole(requiredRole)) {
          return <Redirect to="/unauthorized" />;
        }

        if (requiredPermission && !hasPermission(requiredPermission)) {
          return <Redirect to="/unauthorized" />;
        }

        if (authorize && !authorize(user)) {
          return <Redirect to="/unauthorized" />;
        }

        return <Component {...props} />;
      }}
    />
  );
};

export default PrivateRoute;
