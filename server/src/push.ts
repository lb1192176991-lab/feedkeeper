import webpush from "web-push";
import { db } from "./db/index.js";
import { assertPublicHttpUrl, createPublicHttpsAgent } from "./feeds/ssrfGuard.js";

const MAX_DEVICES_PER_USER = 10;
const VAPID_SUBJECT = "https://github.com/visualfusion/feedkeeper";

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where a tap on the notification leads, relative to the app. */
  url: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag?: string;
  /** Unread articles of the feeds that count towards the app icon. */
  unread?: number;
}

type Sender = (target: PushTarget, payload: string) => Promise<void>;

// Reused for every delivery; it checks the address each connection really uses.
const pushAgent = createPublicHttpsAgent();

let vapid: { publicKey: string; privateKey: string } | null = null;

/** The server's own push keys, created on first use and kept in the database. */
function vapidKeys(): { publicKey: string; privateKey: string } {
  if (vapid) return vapid;
  const read = (key: string) => db.prepare<[string], { value: string }>("SELECT value FROM system_settings WHERE key = ?").get(key)?.value;
  let publicKey = read("vapid_public_key");
  let privateKey = read("vapid_private_key");
  if (!publicKey || !privateKey) {
    ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
    const save = db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    db.transaction(() => {
      save.run("vapid_public_key", publicKey!);
      save.run("vapid_private_key", privateKey!);
    })();
  }
  vapid = { publicKey, privateKey };
  return vapid;
}

export function vapidPublicKey(): string {
  return vapidKeys().publicKey;
}

let sender: Sender = async (target, payload) => {
  // The address came from a browser, so it must not lead into the server's own network.
  await assertPublicHttpUrl(target.endpoint);
  const { publicKey, privateKey } = vapidKeys();
  await webpush.sendNotification(target, payload, { TTL: 60 * 60, timeout: 10_000, agent: pushAgent, vapidDetails: { subject: VAPID_SUBJECT, publicKey, privateKey } });
};

/** Replace the function that talks to the push service (tests). */
export function setPushSender(next: Sender | null): void {
  sender = next ?? sender;
}

export function saveDevice(userId: number, target: PushTarget): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO push_devices (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    ).run(userId, target.endpoint, target.keys.p256dh, target.keys.auth);
    // Keep the newest devices only.
    db.prepare(
      `DELETE FROM push_devices WHERE user_id = ? AND id NOT IN (SELECT id FROM push_devices WHERE user_id = ? ORDER BY id DESC LIMIT ?)`,
    ).run(userId, userId, MAX_DEVICES_PER_USER);
  })();
}

export function removeDevice(userId: number, endpoint: string): void {
  db.prepare("DELETE FROM push_devices WHERE user_id = ? AND endpoint = ?").run(userId, endpoint);
}

export function hasDevice(userId: number, endpoint: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM push_devices WHERE user_id = ? AND endpoint = ?").get(userId, endpoint));
}

function devicesOf(userId: number): PushTarget[] {
  return db
    .prepare<[number], { endpoint: string; p256dh: string; auth: string }>("SELECT endpoint, p256dh, auth FROM push_devices WHERE user_id = ?")
    .all(userId)
    .map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }));
}

/** Deliver to every device of the user; devices the push service no longer knows are forgotten. */
export async function sendToUser(userId: number, payload: PushPayload): Promise<number> {
  const body = JSON.stringify(payload);
  let delivered = 0;
  for (const target of devicesOf(userId)) {
    try {
      await sender(target, body);
      delivered++;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) db.prepare("DELETE FROM push_devices WHERE endpoint = ?").run(target.endpoint);
    }
  }
  return delivered;
}

function unreadTotal(userId: number): number {
  return db
    .prepare<[number, number], { n: number }>(
      `SELECT COUNT(*) AS n FROM items i JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?
       WHERE s.badge = 1 AND NOT EXISTS (SELECT 1 FROM item_reads r WHERE r.item_id = i.id AND r.user_id = ?)`,
    )
    .get(userId, userId)!.n;
}

/** Tell the people who asked for it that a feed has new articles. */
export async function notifyNewItems(feed: { id: number; title: string | null; url: string }, newItems: number): Promise<void> {
  const subscribers = db
    .prepare<[number], { user_id: number; label: string | null }>("SELECT user_id, NULLIF(TRIM(label), '') AS label FROM subscriptions WHERE feed_id = ? AND notify = 1")
    .all(feed.id);
  if (subscribers.length === 0) return;

  const latest = db
    .prepare<[number, number], { id: number; title: string | null; content_snippet: string | null }>("SELECT id, title, content_snippet FROM items WHERE feed_id = ? ORDER BY id DESC LIMIT ?")
    .all(feed.id, Math.min(newItems, 10));

  for (const subscriber of subscribers) {
    const muted = db
      .prepare<[number], { keyword: string }>("SELECT keyword FROM user_muted_keywords WHERE user_id = ?")
      .all(subscriber.user_id)
      .map((row) => row.keyword.toLowerCase());
    const fresh = latest.filter((item) => {
      const text = `${item.title ?? ""} ${item.content_snippet ?? ""}`.toLowerCase();
      return !muted.some((keyword) => text.includes(keyword));
    });
    if (fresh.length === 0) continue;

    const first = fresh[0].title?.trim() || feed.url;
    await sendToUser(subscriber.user_id, {
      title: subscriber.label ?? feed.title ?? new URL(feed.url).hostname,
      body: fresh.length > 1 ? `${first} (+${fresh.length - 1})` : first,
      // One new article opens straight in the reader, several lead to the feed's list.
      url: fresh.length === 1 ? `/items?feed=${feed.id}&article=${fresh[0].id}` : `/items?feed=${feed.id}`,
      tag: `feed-${feed.id}`,
      unread: unreadTotal(subscriber.user_id),
    });
  }
}
