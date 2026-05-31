import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sparkles, X } from "lucide-react";
import { trackUpgradeEvent } from "@/lib/analytics.functions";
import { useEffect, useState, type ReactNode } from "react";

interface InlinePromptProps {
  title?: string;
  description?: string;
  context: string;
  targetPlan?: "pro" | "vip";
}

// Inline card variant — embed where a feature is gated.
export function InlineUpgradePrompt({
  title = "Unlock Pro",
  description = "You've hit the Free plan limit. Upgrade to keep going.",
  context,
  targetPlan = "pro",
}: InlinePromptProps) {
  useEffect(() => {
    trackUpgradeEvent({ type: "upgrade_prompt_shown", context, targetPlan });
  }, [context, targetPlan]);

  return (
    <div className="border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/5 rounded p-4 font-mono">
      <div className="flex items-start gap-3">
        <Sparkles className="h-5 w-5 text-[color:var(--color-primary)] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold uppercase tracking-wider neon-text">{title}</div>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Link
              to="/pricing"
              search={{ plan: targetPlan }}
              onClick={() =>
                trackUpgradeEvent({
                  type: "upgrade_button_clicked",
                  context,
                  targetPlan,
                  metadata: { cta: "unlock-pro" },
                })
              }
              className="text-xs uppercase tracking-wider px-3 py-2 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded hover:bg-[color:var(--color-primary)]/10"
            >
              Unlock Pro
            </Link>
            <Link
              to="/pricing"
              onClick={() =>
                trackUpgradeEvent({
                  type: "upgrade_button_clicked",
                  context,
                  targetPlan,
                  metadata: { cta: "compare-plans" },
                })
              }
              className="text-xs uppercase tracking-wider px-3 py-2 border border-border rounded hover:border-[color:var(--color-info)] hover:text-[color:var(--color-info)]"
            >
              Compare Plans
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// Modal variant — for hard-blocks (e.g. limit reached when clicking action).
interface ModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  description?: string;
  context: string;
  targetPlan?: "pro" | "vip";
}

export function UpgradeModal({
  open,
  onOpenChange,
  title = "Unlock Pro",
  description = "You've hit your Free plan limit for this month.",
  context,
  targetPlan = "pro",
}: ModalProps) {
  useEffect(() => {
    if (open) trackUpgradeEvent({ type: "upgrade_prompt_shown", context, targetPlan });
  }, [open, context, targetPlan]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="font-mono">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 uppercase tracking-wider text-sm">
            <Sparkles className="h-4 w-4 text-[color:var(--color-primary)]" />
            <span className="neon-text">{title}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>
        <div className="border border-border bg-card rounded p-3 text-xs text-muted-foreground">
          Upgrade to Pro for 100 BET alerts, unlimited AI verdicts, all live games, full history, and pattern alerts.
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="text-xs uppercase tracking-wider px-3 py-2 border border-border rounded inline-flex items-center gap-1"
          >
            <X className="h-3 w-3" /> Maybe later
          </button>
          <Link
            to="/pricing"
            onClick={() => {
              trackUpgradeEvent({
                type: "upgrade_button_clicked",
                context,
                targetPlan,
                metadata: { cta: "compare-plans" },
              });
              onOpenChange(false);
            }}
            className="text-xs uppercase tracking-wider px-3 py-2 border border-border rounded hover:border-[color:var(--color-info)] hover:text-[color:var(--color-info)]"
          >
            Compare Plans
          </Link>
          <Link
            to="/pricing"
            search={{ plan: targetPlan }}
            onClick={() => {
              trackUpgradeEvent({
                type: "upgrade_button_clicked",
                context,
                targetPlan,
                metadata: { cta: "unlock-pro" },
              });
              onOpenChange(false);
            }}
            className="text-xs uppercase tracking-wider px-3 py-2 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded hover:bg-[color:var(--color-primary)]/10"
          >
            Unlock Pro
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Convenience hook: control modal open state + a wrapper component.
export function useUpgradeModal(context: string, targetPlan: "pro" | "vip" = "pro") {
  const [open, setOpen] = useState(false);
  const trigger = () => setOpen(true);
  const node: ReactNode = (
    <UpgradeModal open={open} onOpenChange={setOpen} context={context} targetPlan={targetPlan} />
  );
  return { trigger, node, open };
}
