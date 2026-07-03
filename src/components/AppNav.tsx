import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/components/auth/AuthProvider";
import { usePlan } from "@/hooks/usePlan";
import { useState, useRef, useEffect } from "react";
import { Menu, X, Zap, LogOut, ChevronDown, Sparkles, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

type LinkItem = { to: string; label: string; search?: Record<string, string> };
type NavItem = LinkItem | { label: string; children: LinkItem[] };

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/analyze", label: "Analyze" },
  { to: "/live", label: "Live Markets" },
  { to: "/crypto", label: "₿ Crypto" },
  {
    label: "Research",
    children: [
      { to: "/patterns", label: "Patterns" },
      { to: "/backtest", label: "Backtest" },
      { to: "/model-validation", label: "Model" },
      { to: "/pattern-performance", label: "Patterns ROI" },
    ],
  },
  {
    label: "Trading",
    children: [
      { to: "/history", label: "P&L / History" },
      { to: "/strategies", label: "Strategies" },
    ],
  },
  { to: "/settings", label: "Settings" },
];

const ALL_LINKS: LinkItem[] = NAV.flatMap((n) =>
  "children" in n ? n.children : [n],
);

function NavDropdown({
  label,
  children,
  path,
}: {
  label: string;
  children: LinkItem[];
  path: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = children.some((c) => path.startsWith(c.to));

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 px-3 py-1.5 text-xs uppercase tracking-wider rounded transition",
          active
            ? "bg-card text-[color:var(--color-primary)] border border-[color:var(--color-primary)]/40"
            : "text-muted-foreground hover:text-foreground hover:bg-card",
        )}
      >
        {label} <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full pt-1 min-w-[180px] z-50">
          <div className="border border-border bg-card rounded shadow-lg py-1">
            {children.map((c) => (
              <Link
                key={c.to}
                to={c.to}
                onClick={() => setOpen(false)}
                className={cn(
                  "block px-3 py-2 text-xs uppercase tracking-wider transition",
                  path.startsWith(c.to)
                    ? "text-[color:var(--color-primary)] bg-muted/40"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                )}
              >
                {c.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AppNav() {
  const { user, signOut } = useAuth();
  const { tier, isAdmin } = usePlan();
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-[oklch(0.13_0_0/0.85)] backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <Link to="/dashboard" className="flex items-center gap-2 font-bold neon-text">
          <Zap className="h-4 w-4 fill-current" />
          <span className="tracking-widest text-sm">EDGEGRAPH AI</span>
        </Link>
        <div className="hidden lg:flex items-center gap-2">
          {NAV.map((item) =>
            "children" in item ? (
              <NavDropdown key={item.label} label={item.label} children={item.children} path={path} />
            ) : (
              <Link
                key={item.label}
                to={item.to}
                search={item.search as never}
                className={cn(
                  "px-3 py-1.5 text-xs uppercase tracking-wider rounded transition",
                  path.startsWith(item.to)
                    ? "bg-card text-[color:var(--color-primary)] border border-[color:var(--color-primary)]/40"
                    : "text-muted-foreground hover:text-foreground hover:bg-card",
                )}
              >
                {item.label}
              </Link>
            ),
          )}
        </div>
        <div className="hidden lg:flex items-center gap-3">
          {isAdmin && (
            <Link to="/admin" className="text-xs uppercase tracking-wider text-muted-foreground hover:text-[color:var(--color-primary)] flex items-center gap-1">
              <Shield className="h-3 w-3" /> Admin
            </Link>
          )}
          {tier === "free" && (
            <Link
              to="/pricing"
              className="text-xs uppercase tracking-wider px-3 py-1.5 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded hover:bg-[color:var(--color-primary)]/10 flex items-center gap-1"
            >
              <Sparkles className="h-3 w-3" /> Upgrade
            </Link>
          )}
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
          {ALL_LINKS.map((l) => (
            <Link
              key={l.label}
              to={l.to}
              search={l.search as never}
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
