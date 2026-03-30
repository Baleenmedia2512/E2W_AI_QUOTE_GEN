import React from 'react';
import { Route, Redirect, RouteProps } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

interface PrivateRouteProps extends RouteProps {
  component: React.ComponentType<any>;
  requiredRole?: string;
  requiredPermission?: string;
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
  ...rest
}) => {
  const { isAuthenticated, hasRole, hasPermission } = useAuthStore();

  return (
    <Route
      {...rest}
      render={(props) => {
        // Check if user is authenticated
        if (!isAuthenticated) {
          return (
            <Redirect
              to={{
                pathname: '/login',
                state: { from: props.location.pathname },
              }}
            />
          );
        }

        // Check role requirement
        if (requiredRole && !hasRole(requiredRole)) {
          return <Redirect to="/unauthorized" />;
        }

        // Check permission requirement
        if (requiredPermission && !hasPermission(requiredPermission)) {
          return <Redirect to="/unauthorized" />;
        }

        // All checks passed, render component
        return <Component {...props} />;
      }}
    />
  );
};

export default PrivateRoute;
