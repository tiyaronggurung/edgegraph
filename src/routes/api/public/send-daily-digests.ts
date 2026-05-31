import * as React from "react";
import { render } from "@react-email/components";
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TEMPLATES } from "@/lib/email-templates/registry";

// Must match values in src/routes/lovable/email/transactional/send.ts
const SITE_NAME = "edgegraph";
const SENDER_DOMAIN = "notify.bettinggraph.app";
const FROM_DOMAIN = "notify.bettinggraph.app";

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Daily digest dispatcher.
 *
 * Called by pg_cron daily at 13:00 UTC. For every user with
 * alert_frequency = 'daily_digest' and unsent pending_digest_alerts rows,
 * render one rollup email and enqueue via transactional_emails queue.
 * Marks the included rows as sent.
 *
 * Public route — no payload required.
 */
export const Route = createFileRoute("/api/public/send-daily-digests")({
  server: {
    handlers: {
      POST: async () => {
        const template = TEMPLATES["daily-digest"];
        if (!template) {
          return Response.json({ ok: false, error: "template_missing" }, { status: 500 });
        }

        // 1. Find candidate users: digest mode + has unsent alerts.
        const { data: rows, error: rowsErr } = await supabaseAdmin
          .from("pending_digest_alerts")
          .select(
            "id, user_id, market_ticker, market_title, side, side_label, fair_prob, market_prob, edge_pts, pattern, kelly_half, sport, alert_date, created_at",
          )
          .eq("sent", false)
          .limit(5000);

        if (rowsErr) {
          return Response.json({ ok: false, error: rowsErr.message }, { status: 500 });
        }
        if (!rows || rows.length === 0) {
          return Response.json({ ok: true, users: 0, sent: 0, items: 0 });
        }

        // Group by user.
        const byUser = new Map<string, typeof rows>();
        for (const r of rows) {
          if (!byUser.has(r.user_id)) byUser.set(r.user_id, [] as any);
          byUser.get(r.user_id)!.push(r);
        }

        // 2. Pull profiles for these users (email + frequency).
        const userIds = Array.from(byUser.keys());
        const { data: profiles, error: profErr } = await supabaseAdmin
          .from("profiles")
          .select("id, email, alert_frequency")
          .in("id", userIds);
        if (profErr) {
          return Response.json({ ok: false, error: profErr.message }, { status: 500 });
        }

        const today = new Date().toISOString().slice(0, 10);
        let usersSent = 0;
        let itemsSent = 0;
        const skipped: Record<string, number> = {};
        const bump = (k: string) => {
          skipped[k] = (skipped[k] ?? 0) + 1;
        };

        for (const profile of profiles ?? []) {
          const userRows = byUser.get(profile.id);
          if (!userRows || userRows.length === 0) continue;

          // Respect current preference — user may have switched off digest mode
          // since rows were queued; in that case drop the rows without sending.
          if (profile.alert_frequency !== "daily_digest") {
            const ids = userRows.map((r) => r.id);
            await supabaseAdmin
              .from("pending_digest_alerts")
              .update({ sent: true, sent_at: new Date().toISOString() })
              .in("id", ids);
            bump("frequency_changed");
            continue;
          }

          if (!profile.email) {
            bump("no_email");
            continue;
          }

          const items = userRows.map((r) => ({
            marketTitle: r.market_title ?? r.market_ticker,
            sideLabel: r.side_label ?? r.side,
            fairProb: Number(r.fair_prob ?? 0),
            marketProb: Number(r.market_prob ?? 0),
            edgePts: Number(r.edge_pts ?? 0),
            pattern: r.pattern,
            kellyHalf: r.kelly_half ? Number(r.kelly_half) : null,
            sport: r.sport,
          }));

          // Suppression check.
          const normalizedEmail = profile.email.toLowerCase();
          const { data: suppressed } = await supabaseAdmin
            .from("suppressed_emails")
            .select("id")
            .eq("email", normalizedEmail)
            .maybeSingle();
          if (suppressed) {
            const ids = userRows.map((r) => r.id);
            await supabaseAdmin
              .from("pending_digest_alerts")
              .update({ sent: true, sent_at: new Date().toISOString() })
              .in("id", ids);
            bump("suppressed");
            continue;
          }

          // Get or create unsubscribe token.
          let unsubscribeToken: string;
          const { data: existingToken } = await supabaseAdmin
            .from("email_unsubscribe_tokens")
            .select("token")
            .eq("email", normalizedEmail)
            .maybeSingle();
          if (existingToken?.token) {
            unsubscribeToken = existingToken.token;
          } else {
            unsubscribeToken = generateToken();
            await supabaseAdmin
              .from("email_unsubscribe_tokens")
              .upsert(
                { token: unsubscribeToken, email: normalizedEmail },
                { onConflict: "email", ignoreDuplicates: true },
              );
            const { data: reRead } = await supabaseAdmin
              .from("email_unsubscribe_tokens")
              .select("token")
              .eq("email", normalizedEmail)
              .maybeSingle();
            if (reRead?.token) unsubscribeToken = reRead.token;
          }

          // Render template.
          const templateData = { date: today, items };
          const element = React.createElement(template.component, templateData);
          const html = await render(element);
          const plainText = await render(element, { plainText: true });
          const resolvedSubject =
            typeof template.subject === "function"
              ? template.subject(templateData)
              : template.subject;

          const messageId = crypto.randomUUID();
          const idempotencyKey = `daily-digest-${profile.id}-${today}`;

          // Log pending.
          await supabaseAdmin.from("email_send_log").insert({
            message_id: messageId,
            template_name: "daily-digest",
            recipient_email: profile.email,
            status: "pending",
          });

          const { error: enqueueErr } = await supabaseAdmin.rpc("enqueue_email", {
            queue_name: "transactional_emails",
            payload: {
              message_id: messageId,
              to: profile.email,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              sender_domain: SENDER_DOMAIN,
              subject: resolvedSubject,
              html,
              text: plainText,
              purpose: "transactional",
              label: "daily-digest",
              idempotency_key: idempotencyKey,
              unsubscribe_token: unsubscribeToken,
              queued_at: new Date().toISOString(),
            },
          });

          if (enqueueErr) {
            await supabaseAdmin.from("email_send_log").insert({
              message_id: messageId,
              template_name: "daily-digest",
              recipient_email: profile.email,
              status: "failed",
              error_message: "Failed to enqueue daily digest",
            });
            bump("enqueue_failed");
            continue;
          }

          // Mark rows as sent so they don't appear in tomorrow's digest.
          const ids = userRows.map((r) => r.id);
          await supabaseAdmin
            .from("pending_digest_alerts")
            .update({ sent: true, sent_at: new Date().toISOString() })
            .in("id", ids);

          usersSent += 1;
          itemsSent += items.length;
        }

        return Response.json({
          ok: true,
          users: usersSent,
          items: itemsSent,
          skipped,
        });
      },
    },
  },
});
