import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../types';
import { canAccessRole } from '../../services/roleAccess';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRole?: UserRole;
  loginPath?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRole, loginPath }) => {
  const { authState, isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();

  // Keep the current URL in place while an existing API session is restored.
  // Otherwise a refresh of a protected route briefly redirects to login.
  if (authState === 'validating' || authState === 'loading') {
    return null;
  }

  if (!isAuthenticated || !user) {
    const destination = loginPath ?? (allowedRole === 'agent' ? '/agent/login' : allowedRole === 'factory_manager' ? '/factory/login' : '/manager/login');
    return <Navigate to={destination} replace />;
  }

  if (!canAccessRole(user.role, allowedRole)) {
    return (
      <main className="min-h-[100dvh] grid place-items-center bg-slate-950 px-6 text-center text-white">
        <div className="max-w-md">
          <ShieldX className="mx-auto h-14 w-14 text-rose-400" />
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-rose-300">403 Access Denied</p>
          <h1 className="mt-2 text-3xl font-extrabold">You do not have permission to open this portal.</h1>
          <p className="mt-3 text-sm text-slate-400">Your authenticated role is {user.role.replace('_', ' ')}.</p>
          <button
            type="button"
            onClick={() => {
              logout();
              navigate(loginPath ?? (allowedRole === 'factory_manager' ? '/factory/login' : allowedRole === 'agent' ? '/agent/login' : '/manager/login'), { replace: true });
            }}
            className="mt-6 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          >
            {allowedRole === 'factory_manager' ? 'Switch to Factory Manager Login' : 'Sign in with an authorized account'}
          </button>
        </div>
      </main>
    );
  }

  return <>{children}</>;
};
