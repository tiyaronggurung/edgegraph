# Subscription System QA Notes

## Current Status

- Subscription architecture complete
- Pricing page complete
- Plan gating complete
- Upgrade analytics complete
- Stripe integration stubbed (not yet enabled)

## Admin Test Account

- Email: dipeshtamu95@gmail.com
- is_admin: true
- Default testing tier: VIP

## Plan Limits

### Free

- 5 BET alerts/month
- 5 AI verdicts/month
- 1 saved strategy
- Top 3 live games
- Last 7 days history
- CLV tracking locked

### Pro

- 100 BET alerts/month
- Unlimited AI verdicts
- 10 saved strategies
- All live games
- CLV tracking enabled
- Unlimited history

### VIP

- Unlimited BET alerts
- Unlimited AI verdicts
- Unlimited strategies
- All live games
- All premium features enabled

## Analytics Events

- pricing_page_viewed
- upgrade_prompt_shown
- upgrade_cta_clicked
- plan_selected

## Known Non-Issues

- Grammarly hydration warning (browser extension)
- Vite HMR stale chunk "Invalid server function ID" after hot reload; resolved with refresh

## Stripe Readiness

The following components are already prepared:

- subscription_tier
- subscription_status
- billing_interval
- stripe_customer_id
- stripe_subscription_id
- usage_counters
- upgrade_events

To enable live billing later:

1. Create Stripe products/prices
2. Create checkout session endpoint
3. Create Stripe webhook handler
4. Connect Upgrade buttons to checkout

## Manual Testing Checklist

- Free tier gates
- Pro tier gates
- VIP tier gates
- Admin tier switching
- Upgrade analytics logging
- Mobile pricing page
- Pricing comparison table
- Upgrade prompts
- History restrictions
- CLV restrictions
- Strategy limits
- Live game limits

## Files Changed

### Created

- `src/lib/plans/config.ts` — Plan definitions, feature matrix, pricing helpers
- `src/hooks/usePlan.ts` — React hook: current tier, usage, capabilities, remaining limits
- `src/lib/usage.functions.ts` — Server functions: incrementAlert, incrementVerdict, getPlanAndUsage, adminSetTier
- `src/lib/analytics.functions.ts` — Server functions: logUpgradeEvent, getUpgradeEvents
- `src/routes/pricing.tsx` — Public pricing page with tier cards, billing toggle, comparison table
- `src/routes/_authenticated/admin.tsx` — Admin tier-switcher panel (gated to is_admin)
- `src/components/pricing/PricingCard.tsx` — Individual pricing card component
- `src/components/pricing/ComparisonTable.tsx` — Feature comparison across tiers
- `src/components/pricing/BillingToggle.tsx` — Monthly/annual billing toggle
- `src/components/upgrade/UpgradePrompt.tsx` — Reusable upgrade prompt dialog

### Database Migration

- `supabase/migrations/20260531045119_76d83488-e638-4819-a6d9-3231a77818ee.sql` — Adds subscription fields to profiles, creates usage_counters and upgrade_events tables, RLS policies

### Modified

- `src/components/AppNav.tsx` — Added pricing link, admin nav link when is_admin
- `src/components/edge/VerdictCard.tsx` — Wrapped BET alert send with incrementAlert gate
- `src/components/edge/ClvLedger.tsx` — Added paywall for free users
- `src/routes/_authenticated/live.tsx` — Free users see top 3 games + locked upgrade card
- `src/routes/_authenticated/strategies.tsx` — Enforced saved strategy limits
- `src/routes/_authenticated/history.tsx` — Free users limited to last 7 days
- `src/integrations/supabase/types.ts` — Auto-generated type updates
- `src/routeTree.gen.ts` — Auto-generated route tree updates
