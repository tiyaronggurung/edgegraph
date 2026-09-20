import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center font-mono">
        <h1 className="text-7xl font-bold neon-text">404</h1>
        <h2 className="mt-4 text-xl font-semibold uppercase tracking-wider">Signal lost</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The route you're looking for has no live data feed.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded border border-[color:var(--color-primary)] px-4 py-2 text-sm uppercase tracking-wider text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)]/10"
          >
            Return to base
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center font-mono">
        <h1 className="text-xl font-semibold tracking-tight">RUNTIME ERROR</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded border border-[color:var(--color-primary)] px-4 py-2 text-sm uppercase tracking-wider text-[color:var(--color-primary)]"
          >
            Retry
          </button>
          <a
            href="/"
            className="rounded border border-border px-4 py-2 text-sm uppercase tracking-wider"
          >
            Home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "EdgeGraph AI — Sports Betting Graph Intelligence" },
      { name: "description", content: "AI pattern learning for live sports betting graphs. Upload graphs, detect patterns, estimate high-confidence outcomes." },
      { name: "author", content: "EdgeGraph AI" },
      { property: "og:title", content: "EdgeGraph AI — Sports Betting Graph Intelligence" },
      { property: "og:description", content: "AI pattern learning for live sports betting graphs. Upload graphs, detect patterns, estimate high-confidence outcomes." },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "EdgeGraph AI — Sports Betting Graph Intelligence" },
      { name: "twitter:description", content: "AI pattern learning for live sports betting graphs. Upload graphs, detect patterns, estimate high-confidence outcomes." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d25c56d4-6343-4ff5-930b-635e8e707811/id-preview-36fab289--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app-1779316377456.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d25c56d4-6343-4ff5-930b-635e8e707811/id-preview-36fab289--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app-1779316377456.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AuthCacheBridge() {
  const router = useRouter();
  const qc = useQueryClient();
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      if (event === "SIGNED_OUT") {
        // Stop in-flight protected queries before their 401s land, then drop cache.
        qc.cancelQueries();
        qc.clear();
      }
      router.invalidate();
      if (event !== "SIGNED_OUT") {
        qc.invalidateQueries();
        // Force an immediate refetch of everything on screen, then again once
        // the post-login page has mounted its own feeds — this is what makes
        // price, volume and odds fill in without a manual reload.
        void qc.refetchQueries({ type: "active" });
        window.setTimeout(() => {
          void qc.refetchQueries({ type: "active" });
        }, 800);
        window.setTimeout(() => {
          void qc.refetchQueries({ type: "active" });
        }, 2_500);
      }
      if (event === "SIGNED_IN" && typeof window !== "undefined") {
        const stored = sessionStorage.getItem("post_login_redirect");
        if (stored && stored.startsWith("/") && !stored.startsWith("//")) {
          sessionStorage.removeItem("post_login_redirect");
          router.navigate({ to: stored });
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [router, qc]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthCacheBridge />
        <Outlet />
        <Toaster position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
