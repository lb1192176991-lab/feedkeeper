import { api } from "../api/client.ts";

export type PushStatus = "unsupported" | "blocked" | "off" | "on";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const subscription = await (await registration())?.pushManager.getSubscription();
  if (!subscription) return "off";
  const { registered } = await api.checkPushDevice(subscription.endpoint).catch(() => ({ registered: true }));
  return registered ? "on" : "off";
}

function toKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/** Ask for permission, subscribe this device and tell the server about it. */
export async function enablePush(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  const reg = await registration();
  if (!reg) return "unsupported";
  if ((await Notification.requestPermission()) !== "granted") return "blocked";
  const { publicKey } = await api.pushKey();
  const subscription = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return "off";
  await api.savePushDevice({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  return "on";
}

export async function disablePush(): Promise<void> {
  const subscription = await (await registration())?.pushManager.getSubscription();
  if (!subscription) return;
  await api.removePushDevice(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}
