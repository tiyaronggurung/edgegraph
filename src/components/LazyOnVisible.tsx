import { ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Mount `children` only when the placeholder scrolls near the viewport.
 * Used on the crypto page so 20 heavy panels don't all fire queries on
 * initial paint. Once mounted the child stays mounted (no unmount thrash).
 *
 * Wrap the child in <Suspense> internally — callers pass a lazy() component
 * and don't need a second boundary.
 */
export function LazyOnVisible({
  children,
  minHeight = 120,
  rootMargin = "400px",
  fallback,
}: {
  children: ReactNode;
  minHeight?: number;
  rootMargin?: string;
  fallback?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  const skel = fallback ?? (
    <div
      className="border border-border rounded-lg bg-card p-6 flex items-center justify-center text-xs text-muted-foreground"
      style={{ minHeight }}
    >
      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading panel…
    </div>
  );

  return (
    <div ref={ref} style={{ minHeight: visible ? undefined : minHeight }}>
      {visible ? <Suspense fallback={skel}>{children}</Suspense> : skel}
    </div>
  );
}
