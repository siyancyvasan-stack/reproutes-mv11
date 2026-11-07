import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../services/apiClient";
import type { User } from "../types";

const destinationFor = (role: User["role"]) =>
  role === "admin"
    ? "/admin/dashboard"
    : role === "factory_manager"
      ? "/factory/dashboard"
      : role === "agent"
        ? "/sales/dashboard"
        : "/manager/dashboard";

export function MobileSessionPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { acceptSession } = useAuth();
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const code = params.get("code");
    if (!code) {
      setError("Mobile session code is missing.");
      return;
    }
    void apiRequest<{ accessToken: string; user: User }>(
      "/api/v1/auth/webview-handoff/exchange",
      {
        method: "POST",
        body: JSON.stringify({ code }),
      },
    )
      .then((session) => {
        acceptSession(session.accessToken, session.user);
        navigate(destinationFor(session.user.role), { replace: true });
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to open the mobile session.",
        );
        window.ReactNativeWebView?.postMessage(
          JSON.stringify({ type: "HANDOFF_FAILED" }),
        );
      });
  }, [acceptSession, navigate, params]);

  return (
    <main className="min-h-[100dvh] grid place-items-center bg-slate-950 px-6 text-center text-white">
      <div>
        <h1 className="text-2xl font-extrabold">Opening TrackSale…</h1>
        <p
          className={`mt-3 text-sm ${error ? "text-rose-300" : "text-slate-400"}`}
        >
          {error || "Securing your mobile session."}
        </p>
      </div>
    </main>
  );
}
