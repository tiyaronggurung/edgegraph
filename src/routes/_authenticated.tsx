import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppNav } from "@/components/AppNav";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

const AUTH_GRACE_KEY = "eg.auth.lastSeenAt";
const AUTH_GRACE_MS = 24 * 60 * 60 * 1000; // 24h — never auto-logout inside this window

function AuthLayout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();

  // Stamp the "last seen authenticated" time whenever we have a live user.
  useEffect(() => {
    if (user && typeof window !== "undefined") {
      try { localStorage.setItem(AUTH_GRACE_KEY, String(Date.now())); } catch { /* ignore */ }
    }
  }, [user]);

  useEffect(() => {
    if (loading || user) return;
    // No live session — but if we saw one within the last 24h, do NOT redirect.
    // Supabase auto-refresh will re-hydrate the session in the background.
    let withinGrace = false;
    try {
      const raw = localStorage.getItem(AUTH_GRACE_KEY);
      const t = raw ? Number(raw) : 0;
      withinGrace = Number.isFinite(t) && t > 0 && Date.now() - t < AUTH_GRACE_MS;
    } catch { /* ignore */ }
    if (withinGrace) return;

    const here = window.location.pathname + window.location.search;
    nav({ to: "/login", search: { redirect: here } });
  }, [user, loading, nav]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground font-mono text-xs uppercase tracking-widest">
        Booting terminal…
      </div>
    );
  }
  if (!user) {
    // Inside 24h grace: keep rendering the shell so the user isn't kicked out.
    // Individual server calls that 401 will surface their own errors, but the
    // UI stays put until Supabase silently refreshes the token.
    let withinGrace = false;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(AUTH_GRACE_KEY) : null;
      const t = raw ? Number(raw) : 0;
      withinGrace = Number.isFinite(t) && t > 0 && Date.now() - t < AUTH_GRACE_MS;
    } catch { /* ignore */ }
    if (!withinGrace) return null;
  }

  return (
    <div className="min-h-screen overflow-x-hidden">
      <AppNav />
      <main className="w-full max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );

}
