import { api } from "../api/client.ts";

type BadgeNavigator = Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/** Show a number of unread articles on the app icon, where the browser supports it. */
export function updateBadge(count: number): void {
  const nav = navigator as BadgeNavigator;
  if (!nav.setAppBadge || !nav.clearAppBadge) return;
  void (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => undefined);
}

export async function refreshBadge(): Promise<void> {
  if (!navigator.onLine) return;
  try {
    const feeds = await api.listFeeds();
    // Only feeds the user chose count towards the number.
    updateBadge(feeds.filter((feed) => feed.badge !== 0).reduce((total, feed) => total + feed.unread_count, 0));
  } catch {
    // Keep the previous number.
  }
}

const CHANGED_EVENT = "fk:items-changed";

/** Call after articles were marked read or unread so the icon catches up. */
export function announceItemsChanged(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function onItemsChanged(listener: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, listener);
  return () => window.removeEventListener(CHANGED_EVENT, listener);
}
