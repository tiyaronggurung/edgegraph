import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";
import { Zap } from "lucide-react";

const loginSearch = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — EdgeGraph AI" }] }),
  validateSearch: loginSearch,
  component: Login,
});

function safeRedirect(raw: string | undefined): string {
  if (!raw) return "/crypto";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/crypto";
}

function Login() {
  const nav = useNavigate();
  const search = useSearch({ from: "/login" });
  const dest = safeRedirect(search.redirect);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Signed in");
    nav({ to: dest });
  };

  const signInWithGoogle = async () => {
    setGoogleLoading(true);
    try {
      sessionStorage.setItem("post_login_redirect", dest);
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error.message ?? "Google sign-in failed");
        setGoogleLoading(false);
        return;
      }
      if (result.redirected) return;
      // Session already set via popup flow
      const stored = sessionStorage.getItem("post_login_redirect");
      sessionStorage.removeItem("post_login_redirect");
      nav({ to: safeRedirect(stored ?? dest) });
    } catch (err) {
      setGoogleLoading(false);
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 font-mono">
      <div className="w-full max-w-sm border border-border bg-card rounded p-6">
        <div className="flex items-center gap-2 neon-text mb-6">
          <Zap className="h-4 w-4 fill-current" />
          <span className="tracking-widest text-sm font-bold">EDGEGRAPH AI</span>
        </div>
        <h1 className="text-xl font-bold mb-1">Sign in</h1>
        <p className="text-xs text-muted-foreground mb-6">Access your terminal.</p>

        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={googleLoading || loading}
          className="w-full py-2.5 mb-4 border border-border rounded flex items-center justify-center gap-2 text-sm hover:bg-muted/40 disabled:opacity-50"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.68 4.1-5.5 4.1-3.31 0-6.01-2.74-6.01-6.1S8.69 5.9 12 5.9c1.88 0 3.14.8 3.86 1.5l2.63-2.53C16.9 3.3 14.65 2.3 12 2.3 6.86 2.3 2.7 6.46 2.7 11.6S6.86 21 12 21c6.93 0 9.5-4.86 9.5-9.4 0-.63-.07-1.11-.16-1.4H12z"/>
          </svg>
          {googleLoading ? "Redirecting…" : "Continue with Google"}
        </button>

        <div className="relative my-4 text-center">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
          <span className="relative bg-card px-2 text-[10px] uppercase tracking-widest text-muted-foreground">or</span>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="terminal-label">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full mt-1 bg-background border border-border rounded px-3 py-2 text-sm focus:border-[color:var(--color-primary)] outline-none"
            />
          </div>
          <div>
            <label className="terminal-label">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full mt-1 bg-background border border-border rounded px-3 py-2 text-sm focus:border-[color:var(--color-primary)] outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading || googleLoading}
            className="w-full py-2.5 mt-2 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] uppercase tracking-wider text-xs rounded hover:bg-[color:var(--color-primary)]/10 disabled:opacity-50"
          >
            {loading ? "Authenticating…" : "⚡ Sign in"}
          </button>
        </form>
        <div className="mt-4 text-xs text-muted-foreground">
          No account?{" "}
          <Link to="/signup" className="text-[color:var(--color-primary)] underline">
            Create one
          </Link>
        </div>
      </div>
    </div>
  );
}
