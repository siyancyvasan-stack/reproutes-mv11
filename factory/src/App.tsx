import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';

const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const FactoryPortalPage = lazy(() => import('./pages/FactoryPortalPage').then((module) => ({ default: module.FactoryPortalPage })));
const MobileSessionPage = lazy(() => import('./pages/MobileSessionPage').then((module) => ({ default: module.MobileSessionPage })));

const LoadingPortal = () => (
  <div className="min-h-[100dvh] grid place-items-center bg-slate-950 text-sm font-semibold text-cyan-300">
    Loading Reproutes Factory…
  </div>
);

const factoryRoute = (section: string) => (
  <ProtectedRoute allowedRole="factory_manager" loginPath="/login">
    <FactoryPortalPage section={section} />
  </ProtectedRoute>
);

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Router>
          <ErrorBoundary portalName="Factory">
            <Suspense fallback={<LoadingPortal />}>
              <Routes>
                <Route path="/" element={<Navigate to="/login" replace />} />
                <Route path="/login" element={<LoginPage portal="factory" />} />
                <Route path="/mobile/session" element={<MobileSessionPage />} />

                {['dashboard', 'orders', 'production', 'products', 'inventory', 'members', 'dispatch', 'sales-tracking', 'retailers', 'contacts', 'invoices', 'reports', 'notifications', 'settings'].map((section) => (
                  <React.Fragment key={section}>
                    <Route path={`/${section}`} element={factoryRoute(section)} />
                  </React.Fragment>
                ))}

                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </Router>
      </ToastProvider>
    </AuthProvider>
  );
}
