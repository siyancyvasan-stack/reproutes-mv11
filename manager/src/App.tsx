import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';

const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const MobileSessionPage = lazy(() => import('./pages/MobileSessionPage').then((module) => ({ default: module.MobileSessionPage })));

const ManagerDashboardPage = lazy(() => import('./pages/ManagerDashboardPage').then((module) => ({ default: module.ManagerDashboardPage })));
const ManagerLiveTrackingPage = lazy(() => import('./pages/ManagerLiveTrackingPage').then((module) => ({ default: module.ManagerLiveTrackingPage })));
const ManagerAgentsPage = lazy(() => import('./pages/ManagerAgentsPage').then((module) => ({ default: module.ManagerAgentsPage })));
const AgentActivityPage = lazy(() => import('./pages/AgentActivityPage').then((module) => ({ default: module.AgentActivityPage })));
const ManagerOrdersPage = lazy(() => import('./pages/ManagerOrdersPage').then((module) => ({ default: module.ManagerOrdersPage })));
const ManagerProductsPage = lazy(() => import('./pages/ManagerProductsPage').then((module) => ({ default: module.ManagerProductsPage })));
const ManagerAttendancePage = lazy(() => import('./pages/ManagerAttendancePage').then((module) => ({ default: module.ManagerAttendancePage })));
const ManagerReportsPage = lazy(() => import('./pages/ManagerReportsPage').then((module) => ({ default: module.ManagerReportsPage })));
const ManagerSettingsPage = lazy(() => import('./pages/ManagerSettingsPage').then((module) => ({ default: module.ManagerSettingsPage })));
const ManagerFuelPage = lazy(() => import('./pages/ManagerFuelPage').then((module) => ({ default: module.ManagerFuelPage })));
const InvoiceManagementPage = lazy(() => import('./pages/InvoiceManagementPage').then((module) => ({ default: module.InvoiceManagementPage })));
const ShopIntelligencePage = lazy(() => import('./pages/ShopIntelligencePage').then((module) => ({ default: module.ShopIntelligencePage })));
const ManagerRetailersPage = lazy(() => import('./pages/ManagerRetailersPage').then((module) => ({ default: module.ManagerRetailersPage })));
const OperationsChatPage = lazy(() => import('./pages/OperationsChatPage').then((module) => ({ default: module.OperationsChatPage })));
const SafetyPage = lazy(() => import('./pages/SafetyPage').then((module) => ({ default: module.SafetyPage })));
const ManagerContactsPage = lazy(() => import('./pages/ContactsPage').then((module) => ({ default: module.ManagerContactsPage })));
const AdminContactManagementPage = lazy(() => import('./pages/AdminContactManagementPage').then((module) => ({ default: module.AdminContactManagementPage })));

const LoadingPortal = () => (
  <div className="min-h-[100dvh] grid place-items-center bg-slate-950 text-sm font-semibold text-cyan-300">
    Loading Reproutes Manager…
  </div>
);

const managerRoute = (page: React.ReactNode) => (
  <ProtectedRoute allowedRole="manager" loginPath="/login">{page}</ProtectedRoute>
);

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Router>
          <ErrorBoundary portalName="Manager">
            <Suspense fallback={<LoadingPortal />}>
              <Routes>
                <Route path="/" element={<Navigate to="/login" replace />} />
                <Route path="/login" element={<LoginPage portal="manager" />} />
                <Route path="/mobile/session" element={<MobileSessionPage />} />

                <Route path="/dashboard" element={managerRoute(<ManagerDashboardPage />)} />
                <Route path="/live-tracking" element={managerRoute(<ManagerLiveTrackingPage />)} />
                <Route path="/agents" element={managerRoute(<ManagerAgentsPage />)} />
                <Route path="/agents/:id/activity" element={managerRoute(<AgentActivityPage />)} />
                <Route path="/orders" element={managerRoute(<ManagerOrdersPage />)} />
                <Route path="/products" element={managerRoute(<ManagerProductsPage />)} />
                <Route path="/attendance" element={managerRoute(<ManagerAttendancePage />)} />
                <Route path="/reports" element={managerRoute(<ManagerReportsPage />)} />
                <Route path="/settings" element={managerRoute(<ManagerSettingsPage />)} />
                <Route path="/fuel" element={managerRoute(<ManagerFuelPage />)} />
                <Route path="/invoices" element={managerRoute(<InvoiceManagementPage />)} />
                <Route path="/shop-intelligence" element={managerRoute(<ShopIntelligencePage />)} />
                <Route path="/retailers" element={managerRoute(<ManagerRetailersPage view="all" />)} />
                <Route path="/retailers/add" element={managerRoute(<ManagerRetailersPage view="add" />)} />
                <Route path="/retailers/pending" element={managerRoute(<ManagerRetailersPage view="pending" />)} />
                <Route path="/chat" element={managerRoute(<OperationsChatPage />)} />
                <Route path="/safety" element={managerRoute(<SafetyPage />)} />
                <Route path="/contacts" element={managerRoute(<ManagerContactsPage />)} />

                <Route
                  path="/admin/dashboard"
                  element={<ProtectedRoute allowedRole="admin"><ManagerDashboardPage /></ProtectedRoute>}
                />
                <Route path="/admin/contacts" element={<ProtectedRoute allowedRole="admin"><AdminContactManagementPage /></ProtectedRoute>} />

                <Route path="*" element={<Navigate to="/login" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </Router>
      </ToastProvider>
    </AuthProvider>
  );
}
