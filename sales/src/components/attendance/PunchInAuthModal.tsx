import React, { useState, useEffect } from 'react';
import { X, Fingerprint, Eye, EyeOff, Lock, AlertCircle } from 'lucide-react';

export type PunchInAuthMode = 'biometric' | 'password';
export type PunchInAuthResult = 
  | { success: true; mode: PunchInAuthMode }
  | { success: false; error: string };

interface PunchInAuthModalProps {
  isOpen: boolean;
  isPunchOut: boolean;
  biometricAvailable: boolean;
  onClose: () => void;
  onBiometricAuth: () => Promise<void>;
  onPasswordAuth: (password: string) => Promise<void>;
}

export const PunchInAuthModal: React.FC<PunchInAuthModalProps> = ({
  isOpen,
  isPunchOut,
  biometricAvailable,
  onClose,
  onBiometricAuth,
  onPasswordAuth,
}) => {
  const [mode, setMode] = useState<PunchInAuthMode>('biometric');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string>();
  const [biometricError, setBiometricError] = useState<string>();

  useEffect(() => {
    if (isOpen) {
      setMode(biometricAvailable ? 'biometric' : 'password');
      setPassword('');
      setShowPassword(false);
      setError(undefined);
      setBiometricError(undefined);
      setIsAuthenticating(false);
    }
  }, [isOpen, biometricAvailable]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isAuthenticating) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isAuthenticating, onClose]);

  if (!isOpen) return null;

  const handleBiometricAuth = async () => {
    setIsAuthenticating(true);
    setError(undefined);
    setBiometricError(undefined);
    try {
      await onBiometricAuth();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Fingerprint verification failed.';
      setBiometricError(errorMessage);
      setError(errorMessage);
      // Automatically show password option after biometric failure
      setMode('password');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handlePasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Please enter your password.');
      return;
    }
    setIsAuthenticating(true);
    setError(undefined);
    try {
      await onPasswordAuth(password);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Password verification failed.';
      setError(errorMessage);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const actionTitle = isPunchOut ? 'Punch Out' : 'Punch In';
  const actionDescription = isPunchOut
    ? 'Verify your identity to end your shift'
    : 'Verify your identity to start your shift';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 backdrop-blur-sm sm:items-center"
      onClick={(e) => e.target === e.currentTarget && !isAuthenticating && onClose()}
    >
      <div
        className="relative w-full max-w-md rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 id="auth-modal-title" className="text-xl font-black text-slate-900">
              {actionTitle}
            </h2>
            <p className="text-sm text-slate-500">{actionDescription}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isAuthenticating}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Global Error Display */}
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-rose-900">Verification Failed</p>
                <p className="text-sm text-rose-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Biometric Not Available Message */}
          {!biometricAvailable && mode === 'biometric' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900">Fingerprint Unavailable</p>
                <p className="text-sm text-amber-700 mt-1">
                  Fingerprint authentication is not available on this device. Please use your password instead.
                </p>
              </div>
            </div>
          )}

          {/* Mode Selector */}
          <div className="flex gap-2">
            {biometricAvailable && (
              <button
                type="button"
                onClick={() => {
                  setMode('biometric');
                  setError(undefined);
                }}
                disabled={isAuthenticating}
                className={`flex-1 rounded-xl border-2 px-4 py-3 text-sm font-bold transition-colors ${
                  mode === 'biometric'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                } disabled:opacity-50`}
              >
                <Fingerprint className="h-5 w-5 mx-auto mb-1" />
                Fingerprint
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMode('password');
                setError(undefined);
              }}
              disabled={isAuthenticating}
              className={`flex-1 rounded-xl border-2 px-4 py-3 text-sm font-bold transition-colors ${
                mode === 'password'
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              } disabled:opacity-50`}
            >
              <Lock className="h-5 w-5 mx-auto mb-1" />
              Password
            </button>
          </div>

          {/* Biometric Mode */}
          {mode === 'biometric' && biometricAvailable && (
            <div className="pt-4">
              {biometricError && (
                <div className="mb-4 rounded-xl bg-rose-50 border border-rose-200 p-3">
                  <p className="text-xs text-rose-700">{biometricError}</p>
                  <p className="text-xs text-rose-600 mt-2 font-semibold">
                    Try using your password instead.
                  </p>
                </div>
              )}
              <div className="flex flex-col items-center py-8">
                <div className="relative mb-6">
                  <div
                    className={`absolute inset-0 rounded-full ${
                      isAuthenticating
                        ? 'animate-spin border-4 border-indigo-400 border-t-transparent'
                        : 'border-4 border-indigo-200'
                    }`}
                  />
                  <div className="relative rounded-full bg-indigo-100 p-8">
                    <Fingerprint className="h-16 w-16 text-indigo-600" />
                  </div>
                </div>
                <p className="text-center text-sm font-semibold text-slate-900 mb-2">
                  {isAuthenticating ? 'Verifying...' : 'Touch Fingerprint Sensor'}
                </p>
                <p className="text-center text-xs text-slate-500 max-w-xs">
                  Use your device's fingerprint, face recognition, or PIN to verify your identity.
                </p>
              </div>
              <button
                type="button"
                onClick={handleBiometricAuth}
                disabled={isAuthenticating}
                className="w-full rounded-xl bg-indigo-600 px-6 py-3.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {isAuthenticating ? 'Verifying...' : 'Verify with Fingerprint'}
              </button>
            </div>
          )}

          {/* Password Mode */}
          {mode === 'password' && (
            <form onSubmit={handlePasswordAuth} className="pt-4 space-y-4">
              <div>
                <label htmlFor="password-input" className="block text-sm font-bold text-slate-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password-input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError(undefined);
                    }}
                    placeholder="Enter your password"
                    disabled={isAuthenticating}
                    autoFocus
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-12 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isAuthenticating}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 disabled:opacity-50"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={isAuthenticating || !password.trim()}
                className="w-full rounded-xl bg-indigo-600 px-6 py-3.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {isAuthenticating ? 'Verifying...' : `Verify & ${actionTitle}`}
              </button>
            </form>
          )}

          {/* Secondary Actions */}
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isAuthenticating}
              className="text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
