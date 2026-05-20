import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Zap } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — EdgeGraph AI" }] }),
  component: Login,
});

function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Signed in");
    nav({ to: "/dashboard" });
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
            disabled={loading}
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
