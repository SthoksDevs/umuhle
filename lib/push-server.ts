// lib/push-server.ts
//
// Server-side half of the push backbone: sends a Web Push notification to
// every device a profile has subscribed from (lib/push-client.ts +
// app/api/push/subscribe/route.ts populate push_subscriptions).
//
// IMPORTANT: nothing calls sendPushToProfile() yet. This is deliberately
// just the backbone — wiring it into an actual moment (booking confirmed,
// order shipped, WhatsApp-equivalent events in lib/whatsapp.ts) is a
// separate follow-up, once you've decided which events should also push.
//
// Uses a plain @supabase/supabase-js client with the service-role key —
// same pattern as app/api/cron/admin-digest/route.ts's serviceClient() —
// rather than the cookies-based lib/supabase/server.ts client, since this
// needs to be callable from cron jobs and webhooks with no user session,
// not just from within a request that has the caller's cookies.
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

let vapidConfigured = false;
function ensureVapidConfigured() {
  if (vapidConfigured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys are not set (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).");
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:info@umuhle.co.za",
    publicKey,
    privateKey
  );
  vapidConfigured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  icon?: string;
};

/**
 * Sends `payload` to every device profileId has subscribed from. Prunes
 * subscriptions the push service reports as gone (410/404 — the user
 * uninstalled, cleared site data, or revoked permission) so the table
 * doesn't accumulate dead endpoints. Never throws for per-device send
 * failures — only for missing VAPID config, which is a deploy-config bug
 * worth surfacing loudly.
 */
export async function sendPushToProfile(profileId: string, payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  ensureVapidConfigured();
  const supabase = serviceClient();

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("profile_id", profileId);

  if (error) {
    console.error("sendPushToProfile: failed to load subscriptions:", error.message);
    return { sent: 0, pruned: 0 };
  }
  if (!subs || subs.length === 0) return { sent: 0, pruned: 0 };

  let sent = 0;
  let pruned = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        pruned++;
      } else {
        console.error("sendPushToProfile: send failed for one device:", err);
      }
    }
  }

  return { sent, pruned };
}
