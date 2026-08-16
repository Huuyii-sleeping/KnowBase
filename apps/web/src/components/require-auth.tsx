import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { authStorage, type AuthUser } from '@/lib/api';

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [authenticated, setAuthenticated] = useState(
    () => Boolean(authStorage.getToken() && authStorage.getUser()),
  );
  useEffect(() => authStorage.subscribe(() => {
    setAuthenticated(Boolean(authStorage.getToken() && authStorage.getUser()));
  }), []);
  if (!authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

export function RequireRole({ role, children }: { role: AuthUser['role']; children: ReactNode }) {
  const user = authStorage.getUser();
  if (user?.role !== role) return <Navigate to="/documents" replace />;
  return children;
}
