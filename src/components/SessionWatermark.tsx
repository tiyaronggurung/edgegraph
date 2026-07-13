import { useAuth } from "@/components/auth/AuthProvider";

/**
 * Diagonal repeating email watermark over authenticated pages.
 * pointer-events-none so it never interferes with clicks/scroll.
 * Low opacity, screen-only — deters screenshot leaking without impacting UX.
 */
export function SessionWatermark() {
  const { user } = useAuth();
  const label = user?.email ?? user?.id ?? "";
  if (!label) return null;

  const line = `${label} · ${new Date().toISOString().slice(0, 10)}`;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden select-none print:hidden"
      style={{ opacity: 0.05 }}
    >
      <div
        className="absolute inset-[-50%] flex flex-wrap gap-x-16 gap-y-10 text-[11px] font-mono text-foreground"
        style={{ transform: "rotate(-30deg)", whiteSpace: "nowrap" }}
      >
        {Array.from({ length: 240 }).map((_, i) => (
          <span key={i}>{line}</span>
        ))}
      </div>
    </div>
  );
}
