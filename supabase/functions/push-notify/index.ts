// push-notify — drains notification_events and sends web push.
//
// Called two ways:
//   • by the app after an admin action (user JWT in Authorization) — a "poke"
//   • by the notify-cron GitHub Action every 30 min (x-cron-secret header),
//     which also generates the scheduled kinds: call reminders and nudges
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…),
// NOTIFY_CRON_SECRET. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected.
// "Enforce JWT verification" must be OFF for this function; auth is checked here.

import webpush from "npm:web-push@3.6.7";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
const CRON_SECRET = Deno.env.get("NOTIFY_CRON_SECRET") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type EventRow = {
  id: string; group_id: string; season_id: string | null; kind: string;
  payload: Record<string, unknown>; recipient_ids: string[] | null;
};

// Body text may contain {at}; the service worker formats it in the device's zone.
function compose(e: EventRow): { title: string; body: string; url: string; tag: string; at?: string } {
  const p = e.payload as { season_number?: number; title?: string | null; film?: string | null; next_call_date?: string | null };
  const n = p.season_number ?? "";
  const url = "/";
  const at = p.next_call_date ?? undefined;
  switch (e.kind) {
    case "season_open":
      return { title: `Season ${n} is open`, body: p.title ? `Pick your movie — theme: ${p.title}` : "Pick your movie.", url, tag: `season-${e.season_id}` };
    case "guessing_open":
      return { title: "Picks are in", body: "Guess who picked what.", url, tag: `season-${e.season_id}` };
    case "watching_open":
    case "next_film":
      return { title: `This week: ${p.film ?? "the next film"}`, body: at ? "Call {at}" : "Watch it before the next call.", url, tag: `film-${e.season_id}`, at };
    case "call_24h":
      return { title: "Call tomorrow", body: `${p.film ?? "Movie call"} · {at}`, url, tag: `call-${e.season_id}`, at };
    case "call_1h":
      return { title: "Call in an hour", body: `${p.film ?? "Movie call"} · {at}`, url, tag: `call-${e.season_id}`, at };
    case "review_open":
      return { title: "Rank the season", body: "Everyone's watched — order your favorites.", url, tag: `season-${e.season_id}` };
    case "season_complete":
      return { title: `Season ${n} is a wrap`, body: "See who guessed best.", url, tag: `season-${e.season_id}` };
    case "nudge_pick":
      return { title: "Still need your pick", body: `Season ${n} is waiting on you.`, url, tag: `nudge-${e.season_id}` };
    case "nudge_guess":
      return { title: "Guesses are due", body: `Season ${n} is waiting on you.`, url, tag: `nudge-${e.season_id}` };
    case "nudge_rank":
      return { title: "Your ranking is missing", body: `Season ${n} is waiting on you.`, url, tag: `nudge-${e.season_id}` };
    default:
      return { title: "Movie Club Hub", body: "Something new in your club.", url, tag: `misc-${e.id}` };
  }
}

async function generateScheduled(db: SupabaseClient): Promise<number> {
  let created = 0;
  const now = Date.now();
  const insert = async (row: Record<string, unknown>) => {
    const { error } = await db.from("notification_events").upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (!error) created += 1;
  };

  // Call reminders for watching seasons with a future call date
  const { data: watching } = await db
    .from("seasons")
    .select("id, group_id, season_number, title, current_movie_index, next_call_date")
    .eq("status", "watching")
    .not("next_call_date", "is", null)
    .gt("next_call_date", new Date(now).toISOString());
  for (const s of watching ?? []) {
    const callAt = new Date(s.next_call_date as string).getTime();
    const minutes = (callAt - now) / 60000;
    const { data: pick } = await db.from("movie_picks").select("title").eq("season_id", s.id).eq("watch_order", s.current_movie_index).limit(1).maybeSingle();
    const payload = { season_number: s.season_number, title: s.title, film: pick?.title ?? null, next_call_date: s.next_call_date };
    if (minutes <= 24 * 60 && minutes > 75) {
      await insert({ group_id: s.group_id, season_id: s.id, kind: "call_24h", payload, dedupe_key: `call_24h:${s.id}:${s.next_call_date}` });
    }
    if (minutes <= 75) {
      await insert({ group_id: s.group_id, season_id: s.id, kind: "call_1h", payload, dedupe_key: `call_1h:${s.id}:${s.next_call_date}` });
    }
  }

  // Nudges: once per phase, ~48h after the phase started, only to whoever is behind
  const cutoff = new Date(now - 48 * 3600 * 1000).toISOString();
  const { data: stale } = await db
    .from("seasons")
    .select("id, group_id, season_number, title, status")
    .in("status", ["picking", "guessing", "reviewing"])
    .lt("updated_at", cutoff);
  for (const s of stale ?? []) {
    const { data: rosterData } = await db.rpc("season_recipient_ids", { _season_id: s.id });
    const roster: string[] = (rosterData as string[] | null) ?? [];
    if (roster.length === 0) continue;
    let done = new Set<string>();
    let kind = "";
    if (s.status === "picking") {
      const { data } = await db.from("movie_picks").select("user_id").eq("season_id", s.id);
      done = new Set((data ?? []).map((r) => r.user_id as string)); kind = "nudge_pick";
    } else if (s.status === "guessing") {
      const { data } = await db.from("guesses").select("guesser_id").eq("season_id", s.id);
      done = new Set((data ?? []).map((r) => r.guesser_id as string)); kind = "nudge_guess";
    } else {
      const { data } = await db.from("movie_rankings").select("user_id").eq("season_id", s.id);
      done = new Set((data ?? []).map((r) => r.user_id as string)); kind = "nudge_rank";
    }
    const behind = roster.filter((u) => !done.has(u));
    if (behind.length === 0) continue;
    await insert({
      group_id: s.group_id, season_id: s.id, kind,
      payload: { season_number: s.season_number, title: s.title },
      recipient_ids: behind, dedupe_key: `${kind}:${s.id}`,
    });
  }
  return created;
}

async function drain(db: SupabaseClient) {
  const { data: events } = await db
    .from("notification_events")
    .select("id, group_id, season_id, kind, payload, recipient_ids")
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(50);
  let sent = 0, failed = 0, pruned = 0;
  for (const e of (events ?? []) as EventRow[]) {
    let recipients = e.recipient_ids;
    if (!recipients && e.season_id) {
      const { data } = await db.rpc("season_recipient_ids", { _season_id: e.season_id });
      recipients = (data as string[] | null) ?? [];
    }
    if (!recipients || recipients.length === 0) {
      await db.from("notification_events").update({ sent_at: new Date().toISOString() }).eq("id", e.id);
      continue;
    }
    const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", recipients);
    const message = JSON.stringify(compose(e));
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message, { TTL: 60 * 60 * 24 });
        sent += 1;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await db.from("push_subscriptions").delete().eq("id", s.id);
          pruned += 1;
        } else {
          failed += 1;
        }
      }
    }));
    await db.from("notification_events").update({ sent_at: new Date().toISOString() }).eq("id", e.id);
  }
  return { events: (events ?? []).length, sent, failed, pruned };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type, x-cron-secret" } });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const isCron = CRON_SECRET.length > 0 && req.headers.get("x-cron-secret") === CRON_SECRET;

  if (!isCron) {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const { data, error } = await db.auth.getUser(jwt);
    if (error || !data.user) return json({ error: "unauthorized" }, 401);
  }

  const generated = isCron ? await generateScheduled(db) : 0;
  const result = await drain(db);
  return new Response(JSON.stringify({ generated, ...result }), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
});
