import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ user: null, session: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!active) return;
      setSession(s);
      setLoading(false);
    });

    const startupTimeout = new Promise<Session | null>((resolve) => {
      window.setTimeout(() => resolve(null), 2500);
    });

    Promise.race([
      supabase.auth.getSession().then(({ data }) => data.session),
      startupTimeout,
    ]).then((s) => {
      if (!active) return;
      setSession(s);
      setLoading(false);
      if (!s) supabase.auth.refreshSession().catch(() => undefined);
    });

    // Keep the session alive forever: whenever the tab regains focus or the
    // network comes back (e.g. laptop wake from sleep), force a refresh so
    // an expired access token gets rotated immediately instead of failing
    // the next request and bouncing the user to /login.
    const refresh = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      supabase.auth.refreshSession().catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      active = false;
      subscription.unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
