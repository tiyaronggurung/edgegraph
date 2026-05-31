# Subscription & Pricing System — Plan

You said "Stripe-ready structure, but do not break existing app logic." I'm reading that as: **build the entire pricing UI, plan config, limits enforcement, and gating now — but stop short of wiring real Stripe checkout.** When you're ready to take payments, we'll enable Stripe payments in one extra step and connect the upgrade buttons to it.

If you actually want live Stripe checkout in this same pass, tell me and I'll add the enable step at the front.

---

## What I will build

### 1. Plan config (single source of truth)
New file `src/lib/plans/config.ts` — exports `PLANS` with the three tiers, monthly/annual prices, 20% annual discount, and a typed feature matrix:
- `alertsPerMonth`, `verdictsPerMonth` (numbers, `Infinity` = unlimited)
- `liveGamesLimit` (3 / all / all)
- `historyDays` (7 / Infinity / Infinity)
- `sports` (NBA only / 5 sports / all)
- `patternLibrary` ('view' / 'full' / 'full+alerts')
- `kelly` ('half' / 'full' / 'full+custom')
- `savedStrategies` (1 / 10 / Infinity)
- Booleans: `clvTracking`, `clvAdvanced`, `steamDetection`, `sharpMoneyTracker`, `dailyReport`, `weeklyReport`, `priorityDelivery`, `customAlertBuilder`, `vipCommunity`, `earlyAccess`

### 2. Database (schema only, no Stripe webhook yet)
New migration adds to `profiles`:
- `subscription_tier text default 'free'` ('free' | 'pro' | 'vip')
- `subscription_status text default 'inactive'` ('active' | 'inactive' | 'past_due' | 'canceled')
- `billing_interval text` ('month' | 'year' | null)
- `current_period_end timestamptz`
- `stripe_customer_id text` (nullable, populated later)
- `stripe_subscription_id text` (nullable, populated later)

New table `usage_counters`:
- `user_id`, `period_start date` (first of month), `alerts_sent int`, `verdicts_used int`
- Unique on (user_id, period_start); RLS: own row only

### 3. Plan helper hook
New `src/hooks/usePlan.ts`:
- Reads `profiles.subscription_tier` + current month's `usage_counters`
- Returns `{ plan, features, usage, can: { sendAlert(), useVerdict(), accessSport(s), saveStrategy(count), ... }, remaining: { alerts, verdicts } }`
- Pure read; never mutates

### 4. Server functions for counters
New `src/lib/usage.functions.ts` with `createServerFn` handlers:
- `incrementAlert()` — atomic upsert + check, throws `LIMIT_REACHED` if over
- `incrementVerdict()` — same pattern
- Both protected by `requireSupabaseAuth`

### 5. Pricing page
New route `src/routes/pricing.tsx`:
- 3 cards (Free / Pro / VIP Sharp), Pro flagged "Most Popular"
- Monthly/Annual toggle, annual shows "Save 20%" badge + per-month effective price
- VIP styled with premium accent (gradient border, sharp dark surface, refined typography) using existing semantic tokens — no new hex codes
- Mobile: stack vertically, sticky toggle
- CTA buttons:
  - Current plan → disabled "Current plan"
  - Free → "Get started" (no-op / sign-up)
  - Pro/VIP → "Upgrade" — calls `startCheckout(tier, interval)` stub that currently just shows a toast "Stripe checkout coming soon"; ready to swap for real Stripe call later
- Full comparison table below cards (all features × 3 tiers)

### 6. Gating + upgrade prompts (additive only)
New reusable `<UpgradePrompt>` dialog component + `useUpgradePrompt()` hook.

Wired into these existing flows **without changing their happy-path logic**:
- **BET alert email** (`VerdictCard.tsx` new useEffect): before `sendTransactionalEmail`, call `incrementAlert()`. On `LIMIT_REACHED` → skip send, show upgrade prompt. Existing verdict_log insert + UI untouched.
- **AI verdict request** (find the call site in analyze flow): wrap with `incrementVerdict()`. On limit → upgrade prompt, no API call.
- **Live games list**: free users see top 3 + a locked-card row "Upgrade to see all X games"
- **Strategies save**: button disabled with tooltip past limit
- **Pattern library filters**: filters disabled with overlay for free
- **History page**: free users see last 7 days + "Upgrade for full history"
- **CLV page**: free users see paywall card

### 7. Account/settings — current plan widget
Add a small "Current Plan" card to `/dashboard` or settings showing tier + usage bars + "Manage subscription" link to `/pricing`.

### 8. Public guest flows
**Untouched.** Pricing page is public (anyone can view), but no changes to join/status/booking flows. (Your repo doesn't appear to have those, but I'll grep to confirm before touching anything adjacent.)

---

## What I will NOT do in this pass
- Enable Stripe payments / call `enable_stripe_payments`
- Create real checkout sessions or webhooks
- Modify the working live betting, verdict generation, pattern performance, or CLV page logic (only wrapping with gates)
- Touch the email infrastructure (already working)
- Add any new colors outside `src/styles.css` tokens

When you're ready for live billing, the follow-up is small: enable Stripe payments, create the 4 prices (Pro monthly/annual, VIP monthly/annual), wire `startCheckout()` to a server function, add the webhook to update `profiles.subscription_tier`.

---

## Files touched

**Created:**
- `src/lib/plans/config.ts`
- `src/hooks/usePlan.ts`
- `src/lib/usage.functions.ts`
- `src/routes/pricing.tsx`
- `src/components/pricing/PricingCard.tsx`
- `src/components/pricing/ComparisonTable.tsx`
- `src/components/pricing/BillingToggle.tsx`
- `src/components/upgrade/UpgradePrompt.tsx`
- `src/hooks/useUpgradePrompt.ts`
- `src/components/dashboard/PlanWidget.tsx`
- Migration: `subscription_*` columns + `usage_counters` table

**Edited (surgically — gates added around existing code, nothing replaced):**
- `src/components/edge/VerdictCard.tsx` (gate the new bet-alert email only)
- The AI verdict request call site
- Live games list, strategies, patterns, history, CLV pages — each gets a gate wrapper, no logic changes

---

## Questions before I start

1. **Stripe right now, or stub for later?** (I'm assuming stub.)
2. **Annual price display** — "$23.99/mo billed annually ($287.88/yr)" style ok? Pro annual = $239.90/yr (20% off $299.88), VIP annual = $575.90/yr.
3. **Free tier auth** — should the 5-alert limit apply per calendar month or per rolling 30 days? I'm assuming **calendar month** (resets 1st of each month) — simpler and clearer to users.
4. **Existing users** — everyone gets `subscription_tier='free'` by default. Want me to set you (`dipeshtamu95@gmail.com`) to `vip` for testing?

Reply with answers + "go" and I'll build it.
