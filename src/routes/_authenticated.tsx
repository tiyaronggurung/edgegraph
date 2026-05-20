import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppNav } from "@/components/AppNav";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!loading && !user) nav({ to: "/login" });
  }, [user, loading, nav]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground font-mono text-xs uppercase tracking-widest">
        Booting terminal…
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
