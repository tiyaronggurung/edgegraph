import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { DollarSign, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { placeBetFromVerdict } from "@/lib/bets.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface Props {
  userId: string;
  marketTicker: string;
  side: "YES" | "NO";
  defaultStake: number; // dollars
  defaultEntryPrice: number; // 0..1 (yes price for YES, 1-yes for NO)
  marketTitle?: string | null;
  sideLabel?: string;
}

export function PlaceBetButton({
  userId,
  marketTicker,
  side,
  defaultStake,
  defaultEntryPrice,
  marketTitle,
  sideLabel,
}: Props) {
  const qc = useQueryClient();
  const placeFn = useServerFn(placeBetFromVerdict);
  const [open, setOpen] = useState(false);
  const [stake, setStake] = useState(String(Math.max(1, Math.round(defaultStake))));
  const [price, setPrice] = useState(defaultEntryPrice.toFixed(2));
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const stakeN = Number(stake);
    const priceN = Number(price);
    if (!Number.isFinite(stakeN) || stakeN <= 0) {
      toast.error("Enter a valid stake");
      return;
    }
    if (!Number.isFinite(priceN) || priceN <= 0 || priceN >= 1) {
      toast.error("Price must be between 0 and 1 (e.g. 0.52)");
      return;
    }
    setSubmitting(true);
    try {
      // Find the verdict_log row for this user + ticker + side (created by VerdictCard auto-log).
      const { data: vrow, error: vErr } = await supabase
        .from("verdict_log")
        .select("id, bet_id")
        .eq("user_id", userId)
        .eq("market_ticker", marketTicker)
        .eq("side", side)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (vErr) throw new Error(vErr.message);
      if (!vrow) {
        toast.error("Verdict not logged yet — try again in a moment");
        setSubmitting(false);
        return;
      }
      if (vrow.bet_id) {
        toast.info("A bet is already linked to this verdict — see Verdict Log");
        setSubmitting(false);
        setOpen(false);
        return;
      }
      const res = await placeFn({
        data: { verdictId: vrow.id, stake: stakeN, entryPrice: priceN },
      });
      if (res.alreadyExisted) {
        toast.info("Bet was already placed");
      } else {
        toast.success(`Bet placed: $${stakeN} @ ${priceN}`);
      }
      qc.invalidateQueries({ queryKey: ["verdict-log"] });
      qc.invalidateQueries({ queryKey: ["verdict-log-bets"] });
      qc.invalidateQueries({ queryKey: ["bankroll-stats"] });
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-1.5 w-full flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest font-bold py-1.5 rounded border border-emerald-500/60 text-emerald-400 hover:bg-emerald-500/10"
      >
        <DollarSign className="h-3 w-3" />
        Place Bet
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Place bet on {sideLabel ?? side}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="text-xs text-muted-foreground">
              <div className="font-medium text-foreground">{marketTitle ?? marketTicker}</div>
              <div>Ticker: {marketTicker}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="bet-stake">Stake ($)</Label>
                <Input
                  id="bet-stake"
                  type="number"
                  inputMode="decimal"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bet-price">Entry price (0–1)</Label>
                <Input
                  id="bet-price"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  max="0.99"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Win pays{" "}
              <span className="text-emerald-400">
                +${(Number(stake) * ((1 - Number(price)) / Number(price) || 0)).toFixed(2)}
              </span>{" "}
              · Loss = -${Number(stake).toFixed(2)}. Settles automatically when Kalshi resolves the market.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Place Bet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
