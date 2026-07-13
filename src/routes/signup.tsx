import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Zap } from "lucide-react";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create account — EdgeGraph AI" }] }),
  component: Signup,
});

function Signup() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }
    // Auto-confirm is on — user should have a session immediately.
    if (data.session) {
      toast.success("Account created — welcome!");
      nav({ to: "/dashboard" });
    } else {
      // Fallback: try signing in with the same creds
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (signInErr) return toast.error(signInErr.message);
      toast.success("Account created — welcome!");
      nav({ to: "/dashboard" });
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 font-mono">
      <div className="w-full max-w-sm border border-border bg-card rounded p-6">
        <div className="flex items-center gap-2 neon-text mb-6">
          <Zap className="h-4 w-4 fill-current" />
          <span className="tracking-widest text-sm font-bold">EDGEGRAPH AI</span>
        </div>
        <h1 className="text-xl font-bold mb-1">Create account</h1>
        <p className="text-xs text-muted-foreground mb-6">Start tracking market patterns.</p>
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
            <label className="terminal-label">Password (min 6)</label>
            <input
              type="password"
              required
              minLength={6}
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
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>
        <div className="mt-4 text-xs text-muted-foreground">
          Have an account?{" "}
          <Link to="/login" className="text-[color:var(--color-primary)] underline">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
