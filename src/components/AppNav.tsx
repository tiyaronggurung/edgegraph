import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/components/auth/AuthProvider";
import { useState } from "react";
import { Menu, X, Zap, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/analyze", label: "Analyze" },
  { to: "/live", label: "Live Markets" },
  { to: "/patterns", label: "Patterns" },
  { to: "/backtest", label: "Backtest" },
  { to: "/model-validation", label: "Model" },
  { to: "/strategies", label: "Strategies" },
  { to: "/settings", label: "Settings" },
] as const;

export function AppNav() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-[oklch(0.13_0_0/0.85)] backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <Link to="/dashboard" className="flex items-center gap-2 font-bold neon-text">
          <Zap className="h-4 w-4 fill-current" />
          <span className="tracking-widest text-sm">EDGEGRAPH AI</span>
        </Link>
        <div className="hidden lg:flex items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={cn(
                "px-3 py-1.5 text-xs uppercase tracking-wider rounded transition",
                path.startsWith(l.to)
                  ? "bg-card text-[color:var(--color-primary)] border border-[color:var(--color-primary)]/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-card",
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="hidden lg:flex items-center gap-3">
          <span className="text-xs text-muted-foreground truncate max-w-[180px]">{user?.email}</span>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-1 text-xs uppercase tracking-wider text-[color:var(--color-destructive)] hover:opacity-80"
          >
            <LogOut className="h-3 w-3" /> Sign out
          </button>
        </div>
        <button className="lg:hidden text-foreground" onClick={() => setOpen((v) => !v)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="lg:hidden border-t border-border bg-card px-4 py-3 flex flex-col gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              onClick={() => setOpen(false)}
              className="px-2 py-2 text-sm uppercase tracking-wider text-foreground hover:bg-muted rounded"
            >
              {l.label}
            </Link>
          ))}
          <div className="border-t border-border mt-2 pt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
            <button onClick={() => signOut()} className="text-xs text-[color:var(--color-destructive)]">
              Sign out
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
