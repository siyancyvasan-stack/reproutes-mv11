import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import introSrc from "../assets/intro.mp4";
import { useNavigate } from "react-router-dom";
import { PortalAccessError, useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { GlassCard } from "../components/common/GlassCard";
import {
  requestRegistrationOtp,
  supportsBiometricLogin,
  verifyRegistrationOtp,
} from "../services/authApi";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Fingerprint,
  Play,
  ArrowRight,
  Loader2,
  Sparkles,
  UserPlus,
  ArrowLeft,
  Download,
} from "lucide-react";
import { BrandLogo } from "../components/common/BrandLogo";
import { AppVersion } from "../components/common/AppVersion";
import { UserRole } from "../types";

const INTRO_MAX_WAIT_MS = 30_000;

export type LoginPortal = "manager" | "agent" | "sales" | "factory";

interface LoginPageProps {
  portal: LoginPortal;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export const LoginPage: React.FC<LoginPageProps> = ({ portal }) => {
  const navigate = useNavigate();
  const { login, biometricLogin, logout, authState, isAuthenticated, user } = useAuth();
  const { showToast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register" | "otp">(
    "login",
  );
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState<boolean>();
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricMessage, setBiometricMessage] = useState("");
  const [showIntro, setShowIntro] = useState(false);
  const [introReady, setIntroReady] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent>();
  const [portalAccessDenied, setPortalAccessDenied] = useState(false);
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const configuredUrl = import.meta.env.VITE_API_URL?.trim() || 'same-origin';
        const apiBase = configuredUrl === 'same-origin'
          ? ''
          : configuredUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
        const res = await fetch(`${apiBase}/health/live`, {
          signal: AbortSignal.timeout(10_000),
        });
        setDbConnected(res.ok);
      } catch (err) {
        setDbConnected(false);
      }
    };
    void checkConnection();
    const interval = setInterval(checkConnection, 15000);
    return () => clearInterval(interval);
  }, []);

  const isManagerPortal = portal === "manager";
  const isFactoryPortal = portal === "factory";
  const agentDashboardPath =
    portal === "sales" ? "/sales/dashboard" : "/agent/dashboard";
  const allowedRoles: UserRole[] = isManagerPortal
    ? ["manager", "admin"]
    : isFactoryPortal
      ? ["factory_manager"]
      : ["agent"];
  const dashboardForRole = (role: UserRole) =>
    role === "admin" || role === "manager"
      ? "/dashboard"
      : role === "factory_manager"
        ? "/factory/dashboard"
        : "/sales/dashboard";
  const completeIntro = useCallback(() => {
    setShowIntro(false);
    setIntroReady(false);
  }, []);

  useEffect(() => {
    if (!showIntro) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const fallbackTimer = window.setTimeout(completeIntro, INTRO_MAX_WAIT_MS);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(fallbackTimer);
    };
  }, [completeIntro, showIntro]);

  useEffect(() => {
    void supportsBiometricLogin()
      .then(setBiometricSupported)
      .catch(() => setBiometricSupported(false));
  }, []);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    if (standalone) return;
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(undefined);
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(undefined);
      showToast(
        "Reproutes Installed",
        "Open Reproutes from your phone home screen.",
        "success",
      );
    }
  };

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      const isAllowedInPortal = isFactoryPortal
        ? user.role === "factory_manager"
        : isManagerPortal
          ? user.role === "manager" || user.role === "admin"
          : user.role === "agent";

      if (!isAllowedInPortal) {
        setPortalAccessDenied(true);
        return;
      }

      navigate(
        user.role === "admin"
          ? "/admin/dashboard"
          : isFactoryPortal
            ? "/dashboard"
            : isManagerPortal
              ? "/dashboard"
              : agentDashboardPath,
        {
          replace: true,
        },
      );
    }
  }, [
    agentDashboardPath,
    isAuthenticated,
    user,
    navigate,
    isFactoryPortal,
    isManagerPortal,
  ]);

  const handleBiometricLogin = async () => {
    if (!localStorage.getItem("tf_passkey_registered")) {
      setBiometricMessage(
        "No fingerprint/passkey registered. Sign in with password and enable it in Settings.",
      );
      return;
    }
    setBiometricBusy(true);
    setBiometricMessage("Biometric prompt opened");
    try {
      setBiometricMessage("Verifying identity");
      await biometricLogin(allowedRoles);
      setBiometricMessage("Login successful");
    } catch (error) {
      if (error instanceof PortalAccessError) {
        setPortalAccessDenied(true);
        setBiometricMessage(error.message);
        return;
      }
      const name = error instanceof DOMException ? error.name : "";
      const message = error instanceof Error ? error.message : "";
      if (!navigator.onLine || error instanceof TypeError)
        setBiometricMessage("Network error");
      else if (name === "NotAllowedError")
        setBiometricMessage("User cancelled or fingerprint not recognized");
      else if (name === "InvalidStateError")
        setBiometricMessage("No fingerprint/passkey registered");
      else if (/too many/i.test(message))
        setBiometricMessage("Too many failed attempts");
      else if (/locked/i.test(message))
        setBiometricMessage("Device biometric locked");
      else if (/revoked|expired/i.test(message))
        setBiometricMessage("Credential expired or revoked");
      else setBiometricMessage(message || "Fingerprint not recognized");
    } finally {
      setBiometricBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authMode === "register") {
      if (!name.trim() || !email || !password) {
        showToast(
          "Input Required",
          "Enter your name, email, and password.",
          "error",
        );
        return;
      }
      setRegistrationBusy(true);
      try {
        const response = await requestRegistrationOtp({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
        });
        setAuthMode("otp");
        showToast(
          "OTP Sent",
          `Check your email. The code expires in ${response.expiresInMinutes} minutes.`,
          "success",
        );
      } catch (error) {
        showToast(
          "Registration Failed",
          error instanceof Error
            ? error.message
            : "Unable to send verification email.",
          "error",
        );
      } finally {
        setRegistrationBusy(false);
      }
      return;
    }
    if (authMode === "otp") {
      if (!/^\d{6}$/.test(otp)) {
        showToast(
          "Invalid OTP",
          "Enter the six-digit code from your email.",
          "error",
        );
        return;
      }
      setRegistrationBusy(true);
      try {
        await verifyRegistrationOtp(email.trim().toLowerCase(), otp);
        setAuthMode("login");
        setOtp("");
        showToast(
          "Account Verified",
          "Your Agent account is ready. Sign in with your password.",
          "success",
        );
      } catch (error) {
        showToast(
          "Verification Failed",
          error instanceof Error ? error.message : "Unable to verify the code.",
          "error",
        );
      } finally {
        setRegistrationBusy(false);
      }
      return;
    }
    if (!email || !password) {
      showToast(
        "Input Required",
        "Please enter both email and password.",
        "error",
      );
      return;
    }

    setPortalAccessDenied(false);
    const result = await login(email, password, allowedRoles);
    if (result === "success") {
      showToast(
        "Welcome Back!",
        "Successfully authenticated to Reproutes.",
        "success",
      );
    } else if (result === "access_denied") {
      setPortalAccessDenied(true);
      setPassword("");
      setShowPassword(false);
      showToast(
        "Access Denied",
        "This account does not have access to this portal.",
        "error",
      );
    } else if (result === "rate_limited") {
      showToast(
        "Too Many Attempts",
        "Please wait a few minutes before trying to sign in again.",
        "error",
      );
    } else if (result === "server_unavailable") {
      showToast(
        "Service Temporarily Unavailable",
        "The Reproutes server or database is unavailable. Start the backend services and try again.",
        "error",
      );
    } else if (result === "database_setup_required") {
      showToast(
        "Database Setup Required",
        "The database schema is out of date. Apply the pending migrations, seed the demo accounts, and try again.",
        "error",
      );
    } else {
      setPassword("");
      setShowPassword(false);
      showToast(
        "Invalid Credentials",
        "Please check your email and password.",
        "error",
      );
    }
  };

  return (
    <div className="app-light enterprise-glass min-h-[100dvh] w-full bg-slate-50 text-slate-900 flex flex-col relative overflow-x-hidden selection:bg-cyan-500 selection:text-slate-950">
      {/* User-triggered intro never blocks access to the login form on first load. */}
      {showIntro &&
        createPortal(
          <div
            className="intro-stage fixed inset-0 z-[9999] flex h-[100dvh] w-screen flex-col items-center justify-center overflow-hidden bg-white"
            role="dialog"
            aria-modal="true"
            aria-label="Reproutes introduction"
          >
            {!introReady && (
              <div
                className="absolute inset-0 z-10 grid place-items-center bg-white text-cyan-600"
                role="status"
              >
                <div className="flex items-center gap-3 rounded-full border border-cyan-200 bg-white px-5 py-3 text-sm font-semibold shadow-lg">
                  <Loader2
                    aria-hidden="true"
                    className="h-5 w-5 animate-spin"
                  />
                  Loading Reproutes…
                </div>
              </div>
            )}
            {/* Keep the complete Reproutes logo and wordmark visible on portrait
              phones. Landscape screens can use the full viewport without clipping
              the wide animation horizontally. */}
            <video
              autoPlay
              muted
              playsInline
              preload="metadata"
              onCanPlay={() => setIntroReady(true)}
              onPlaying={() => setIntroReady(true)}
              onWaiting={() => setIntroReady(false)}
              onEnded={completeIntro}
              onError={completeIntro}
              className={`absolute inset-0 z-[1] h-full w-full bg-white object-contain transition-opacity duration-300 ${
                introReady ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden="true"
            >
              <source src={introSrc} type="video/mp4" />
            </video>
            <button
              type="button"
              onClick={completeIntro}
              className="intro-skip-button absolute left-1/2 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-20 min-h-12 -translate-x-1/2 whitespace-nowrap rounded-full border border-cyan-400 bg-slate-950 px-6 py-3 text-sm font-bold text-cyan-300 shadow-2xl transition-all hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-500"
            >
              Skip Intro & Go to Login →
            </button>
          </div>,
          document.body,
        )}

      {/* Main Split Screen Container */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-[100dvh] relative z-10">
        {/* LEFT SECTION (55%): 3D Visual Presentation & Map */}
        <div className="order-2 hidden lg:order-1 lg:col-span-7 lg:flex lg:p-12 flex-col justify-between relative overflow-hidden bg-gradient-to-br from-white via-slate-50 to-blue-50 border-r border-slate-200">
          {/* Subtle Ambient Glows */}
          <div className="ambient-orb absolute -top-20 -left-20 w-96 h-96 bg-cyan-600/20 rounded-full blur-[120px] pointer-events-none" />
          <div className="ambient-orb absolute -bottom-20 -right-20 w-96 h-96 bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />

          {/* Header Branding */}
          <div className="relative z-20 flex items-center justify-between mb-8">
            <BrandLogo large />

            <button
              onClick={() => setShowIntro(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/60 hover:bg-slate-800 border border-slate-700 text-xs text-cyan-400 font-semibold backdrop-blur-md transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-cyan-400" />
              <span>Watch Intro</span>
            </button>
          </div>

          <div className="relative z-20 my-auto overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <video
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              className="aspect-video w-full bg-white object-contain"
              aria-label="Reproutes introduction video"
            >
              <source src={introSrc} type="video/mp4" />
            </video>
          </div>

          <div className="relative z-20 text-xs text-slate-500 pt-4 border-t border-slate-800/80">
            © 2026 Reproutes. All rights reserved. Enterprise field sales
            intelligence.
          </div>
        </div>

        {/* RIGHT SECTION (45%): Glass Login Card */}
        <div className="order-1 lg:order-2 lg:col-span-5 px-4 py-6 min-[360px]:px-6 sm:p-12 flex flex-col items-center justify-center relative bg-white/95">
          <div className="w-full max-w-md space-y-4 sm:space-y-6">
            <div className="flex justify-center">
              <BrandLogo large />
            </div>

            {installPrompt && (
              <button
                type="button"
                onClick={() => void installApp()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-3 text-sm font-extrabold text-cyan-800 shadow-sm transition hover:bg-cyan-100"
              >
                <Download className="h-5 w-5" />
                Install Reproutes
              </button>
            )}

            {/* Mobile Header Branding */}
            <div className="lg:hidden flex items-center justify-end mb-2">
              <button
                onClick={() => setShowIntro(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-700 text-xs text-cyan-400 font-semibold backdrop-blur-md"
              >
                <Play className="w-3 h-3 fill-cyan-400" />
                <span>Intro</span>
              </button>
            </div>

            {/* Login Card Panel */}
            <GlassCard
              glow="cyan"
              className="p-5 min-[360px]:p-6 sm:p-8 shadow-2xl relative overflow-hidden border-slate-700/80"
            >
              {/* Header */}
              <div className="text-center space-y-2 mb-6">
                <h3 className="text-2xl font-extrabold text-white tracking-tight">
                  {authMode === "login"
                    ? isFactoryPortal
                      ? "Factory Portal"
                      : isManagerPortal
                        ? "Manager Portal"
                        : "Sales Portal"
                    : authMode === "register"
                      ? "Create Sales Account"
                      : "Verify Your Email"}
                </h3>
                <p className="text-xs text-slate-400">
                  {authMode === "login"
                    ? `Sign in to continue to the ${isFactoryPortal ? "Factory" : isManagerPortal ? "Manager" : "Sales"} Portal`
                    : authMode === "register"
                      ? "Register securely with email verification"
                      : `Enter the six-digit code sent to ${email}`}
                </p>
              </div>

              {/* Login Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {authMode === "register" && (
                  <div>
                    <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                      Full Name
                    </label>
                    <div className="relative">
                      <UserPlus className="pointer-events-none absolute left-3.5 top-1/2 z-[1] h-4 w-4 shrink-0 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Your full name"
                        autoComplete="name"
                        required
                        className="glass-input w-full rounded-xl !pl-11 !pr-4 py-3 text-sm"
                      />
                    </div>
                  </div>
                )}
                {/* Email Field */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 z-[1] h-4 w-4 shrink-0 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setPortalAccessDenied(false);
                      }}
                      placeholder="name@company.com"
                      required
                      readOnly={authMode === "otp"}
                      autoComplete="email"
                      className="glass-input w-full rounded-xl !pl-11 !pr-4 py-3 text-sm"
                    />
                  </div>
                </div>

                {/* Password Field */}
                {authMode !== "otp" && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Password
                      </label>
                      {authMode === "login" && (
                        <a
                          href="#forgot"
                          onClick={(e) => {
                            e.preventDefault();
                            showToast(
                              "Password Reset",
                              "Reset link sent to registered email.",
                              "info",
                            );
                          }}
                          className="text-xs text-cyan-400 hover:underline"
                        >
                          Forgot password?
                        </a>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3.5 top-1/2 z-[1] h-4 w-4 shrink-0 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setPortalAccessDenied(false);
                        }}
                        placeholder="••••••••••••"
                        required
                        autoComplete={
                          authMode === "register"
                            ? "new-password"
                            : "current-password"
                        }
                        className="glass-input w-full rounded-xl !pl-11 !pr-11 py-3 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-1/2 z-[1] flex !min-h-0 h-9 w-9 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-white"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {authMode === "otp" && (
                  <div>
                    <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                      Verification Code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={otp}
                      onChange={(event) =>
                        setOtp(
                          event.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      placeholder="000000"
                      className="w-full px-4 py-3 text-center text-xl tracking-[0.45em] font-extrabold rounded-xl glass-input"
                      required
                    />
                  </div>
                )}

                {/* Remember Me Checkbox */}
                {authMode === "login" && (
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/20"
                      />
                      <span className="text-xs text-slate-300 font-medium">
                        Remember this device
                      </span>
                    </label>
                  </div>
                )}

                {/* Auth Error Message */}
                {authMode === "login" &&
                  authState === "invalid_credentials" && (
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold text-center">
                      {isManagerPortal || isFactoryPortal
                        ? "Invalid credentials. Please check email and password."
                        : "Account not found or password incorrect. Ask your Manager to create or update your Sales account."}
                    </div>
                  )}

                {authMode === "login" && portalAccessDenied && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold text-center flex flex-col gap-2"
                  >
                    <span>
                      {user
                        ? `Signed in as ${user.email} (${user.role.replace('_', ' ')}). This account does not have access to Manager Portal.`
                        : "This account does not have access to Manager Portal."}
                    </span>
                    {user && (
                      <button
                        type="button"
                        onClick={() => {
                          logout();
                          setPortalAccessDenied(false);
                        }}
                        className="mx-auto px-3 py-1 rounded bg-rose-600/30 hover:bg-rose-600/50 text-white text-[11px] font-bold transition cursor-pointer"
                      >
                        Sign out & Switch Account
                      </button>
                    )}
                  </div>
                )}

                {/* Sign In Button */}
                <button
                  type="submit"
                  disabled={
                    registrationBusy ||
                    authState === "loading" ||
                    authState === "validating"
                  }
                  className="w-full py-3.5 rounded-xl text-sm font-bold text-white glass-button-primary flex items-center justify-center gap-2 shadow-xl cursor-pointer disabled:opacity-50"
                >
                  {registrationBusy ||
                  authState === "loading" ||
                  authState === "validating" ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>
                        {authMode === "login"
                          ? "Authenticating..."
                          : authMode === "register"
                            ? "Sending OTP..."
                            : "Verifying..."}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>
                        {authMode === "login"
                          ? "Sign In"
                          : authMode === "register"
                            ? "Send Verification Code"
                            : "Verify & Create Account"}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {!isManagerPortal &&
                  !isFactoryPortal &&
                  authMode === "login" && (
                    <p className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-center text-xs font-semibold text-cyan-800">
                      Sales accounts are created and managed by your Manager.
                    </p>
                  )}

                {authMode === "login" && (
                  <>
                    <button
                      type="button"
                      disabled={biometricSupported === false || biometricBusy}
                      onClick={() => void handleBiometricLogin()}
                      className="w-full py-2.5 px-4 rounded-xl border border-slate-800 bg-slate-900/40 text-slate-500 text-xs font-semibold flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {biometricBusy ? (
                        <Loader2 className="w-4 h-4 animate-spin text-cyan-500" />
                      ) : (
                        <Fingerprint className="w-4 h-4 text-slate-500" />
                      )}
                      <span>
                        {biometricBusy
                          ? "Verifying identity…"
                          : biometricSupported === false
                            ? "Biometric login is not supported on this device"
                            : localStorage.getItem("tf_passkey_registered")
                              ? "Sign in with Fingerprint"
                              : "Set up fingerprint after password login"}
                      </span>
                    </button>
                    {biometricMessage && (
                      <p
                        className={`text-[10px] text-center font-semibold ${biometricMessage === "Login successful" ? "text-emerald-500" : "text-slate-500"}`}
                      >
                        {biometricMessage}
                      </p>
                    )}
                  </>
                )}
              </form>

              <div className="mt-6 pt-4 border-t border-slate-800 text-center">
                <span className="text-[11px] text-slate-500 flex items-center justify-center gap-1">
                  <Sparkles className="w-3 h-3 text-cyan-400" />
                  Secure 256-bit SSL Encrypted Access
                </span>
              </div>
            </GlassCard>

            <AppVersion portal="manager" />
          </div>
        </div>
      </div>
      <div 
        className={`absolute bottom-0 left-0 w-full h-1 ${dbConnected === true ? 'bg-emerald-500' : dbConnected === false ? 'bg-red-500' : 'bg-transparent'}`} 
        title={dbConnected === true ? 'Connected' : dbConnected === false ? 'Disconnected' : ''} 
      />
    </div>
  );
};
