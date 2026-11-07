import React, { createContext, useCallback, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { ApiError, isBackendConfigured, SESSION_EXPIRED_EVENT, setAccessToken } from '../services/apiClient';
import { loginWithApi, loginWithPasskey, logoutFromApi, restoreApiSession } from '../services/authApi';

declare global {
  interface Window { ReactNativeWebView?: { postMessage(message: string): void } }
}

export type AuthState = 'idle' | 'validating' | 'loading' | 'success' | 'invalid_credentials' | 'rate_limited' | 'database_setup_required' | 'server_unavailable';

export type LoginResult = 'success' | 'access_denied' | 'invalid_credentials' | 'rate_limited' | 'database_setup_required' | 'server_unavailable';

export class PortalAccessError extends Error {
  constructor() {
    super('This account does not have access to this portal.');
    this.name = 'PortalAccessError';
  }
}

interface AuthContextType {
  user: User | null;
  authState: AuthState;
  login: (email: string, pass: string, allowedRoles?: UserRole[]) => Promise<LoginResult>;
  biometricLogin: (allowedRoles?: UserRole[]) => Promise<User>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  isAuthenticated: boolean;
  acceptSession: (accessToken: string, user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    // A saved browser user is only a display cache. When the API is enabled,
    // wait for the refresh cookie to establish the real user and role before
    // rendering protected pages.
    if (isBackendConfigured) return null;
    const saved = localStorage.getItem('tf_auth_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [authState, setAuthState] = useState<AuthState>(() =>
    isBackendConfigured && localStorage.getItem('tf_auth_user') ? 'validating' : 'idle',
  );

  useEffect(() => {
    if (!isBackendConfigured || !localStorage.getItem('tf_auth_user')) return;
    void restoreApiSession()
      .then((sessionUser) => {
        setUser(sessionUser);
        setAuthState('success');
      })
      .catch(() => {
        setUser(null);
        setAuthState('idle');
      });
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem('tf_auth_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('tf_auth_user');
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'SESSION_EXPIRED' }));
    }
  }, [user]);

  useEffect(() => {
    const handleSessionExpired = () => {
      setUser(null);
      setAuthState('idle');
      localStorage.removeItem('tf_auth_user');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  const login = async (
    email: string,
    pass: string,
    allowedRoles?: UserRole[],
  ): Promise<LoginResult> => {
    setAuthState('validating');
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !pass) {
      setAuthState('invalid_credentials');
      return 'invalid_credentials';
    }

    if (!isBackendConfigured) {
      setAuthState('server_unavailable');
      return 'server_unavailable';
    }

    setAuthState('loading');
    try {
      const authenticatedUser = await loginWithApi(cleanEmail, pass);
      if (allowedRoles && !allowedRoles.includes(authenticatedUser.role)) {
        await logoutFromApi();
        setUser(null);
        setAuthState('idle');
        return 'access_denied';
      }
      setUser(authenticatedUser);
      setAuthState('success');
      return 'success';
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setAuthState('rate_limited');
        return 'rate_limited';
      }
      if (error instanceof ApiError && error.code === 'DATABASE_SCHEMA_OUTDATED') {
        setAuthState('database_setup_required');
        return 'database_setup_required';
      }
      const unavailable =
        error instanceof TypeError ||
        (error instanceof ApiError && error.status >= 500) ||
        String(error).includes('fetch');
      setAuthState(unavailable ? 'server_unavailable' : 'invalid_credentials');
      return unavailable ? 'server_unavailable' : 'invalid_credentials';
    }
  };

  const logout = () => {
    if (isBackendConfigured) void logoutFromApi();
    setUser(null);
    setAuthState('idle');
    localStorage.removeItem('tf_auth_user');
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'SIGNED_OUT' }));
  };

  const acceptSession = useCallback((accessToken: string, sessionUser: User) => {
    setAccessToken(accessToken);
    setUser(sessionUser);
    setAuthState('success');
  }, []);

  const biometricLogin = async (allowedRoles?: UserRole[]) => {
    const authenticatedUser = await loginWithPasskey();
    if (allowedRoles && !allowedRoles.includes(authenticatedUser.role)) {
      await logoutFromApi();
      setUser(null);
      setAuthState('idle');
      throw new PortalAccessError();
    }
    setUser(authenticatedUser);
    setAuthState('success');
    return authenticatedUser;
  };

  const updateUser = (updates: Partial<User>) => {
    setUser((current) => current ? { ...current, ...updates } : current);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authState,
        login,
        biometricLogin,
        logout,
        updateUser,
        isAuthenticated: !!user,
        acceptSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
