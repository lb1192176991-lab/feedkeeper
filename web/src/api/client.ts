export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public data?: unknown,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers,
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "unknown_error", body);
  }
  return body as T;
}

export interface DiscoveredFeed {
  url: string;
  title: string | null;
  type: string;
}

export interface User {
  id: number;
  email: string;
  display_name: string;
  role: "admin" | "user";
  created_at: string;
}

export interface Feed {
  id: number;
  url: string;
  title: string | null;
  site_url: string | null;
  poll_interval_minutes: number;
  last_polled_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_errors: number;
  subscription_id: number;
  label: string | null;
  unread_count: number;
}

export interface Item {
  id: number;
  feed_id: number;
  feed_title: string | null;
  title: string | null;
  link: string | null;
  content_snippet: string | null;
  published_at: string | null;
  read: boolean;
}

export interface Token {
  id: number;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface OpmlImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ url: string; reason: string }>;
}

export const api = {
  onboardingStatus: () => request<{ needsOnboarding: boolean }>("/onboarding/status"),
  onboard: (data: { email: string; password: string; displayName: string }) =>
    request<User>("/onboarding", { method: "POST", body: JSON.stringify(data) }),

  login: (email: string, password: string) =>
    request<User>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  me: () => request<User>("/auth/me"),
  listUsers: () => request<User[]>("/auth/users"),
  createUser: (data: { email: string; password: string; displayName: string; role: "admin" | "user" }) =>
    request<User>("/auth/users", { method: "POST", body: JSON.stringify(data) }),

  listFeeds: () => request<Feed[]>("/feeds"),
  discoverFeeds: (url: string) => request<{ feeds: DiscoveredFeed[] }>("/feeds/discover", { method: "POST", body: JSON.stringify({ url }) }),
  subscribeFeed: (url: string, label: string | null) =>
    request<Feed>("/feeds", { method: "POST", body: JSON.stringify({ url, label }) }),
  unsubscribeFeed: (feedId: number) => request<void>(`/feeds/${feedId}`, { method: "DELETE" }),
  updateFeed: (feedId: number, data: { label?: string | null; pollIntervalMinutes?: number }) =>
    request<Feed>(`/feeds/${feedId}`, { method: "PATCH", body: JSON.stringify(data) }),
  exportOpmlUrl: () => "/api/feeds/opml",
  importOpml: (opmlContent: string) =>
    request<OpmlImportResult>("/feeds/opml", {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: opmlContent,
    }),
  refreshFeed: (feedId: number) =>
    request<{ feed: Feed; newItems: number; error: string | null }>(`/feeds/${feedId}/refresh`, { method: "POST" }),
  refreshAllFeeds: () =>
    request<{ refreshed: number; newItems: number; errors: number }>("/feeds/refresh-all", { method: "POST" }),

  listItems: (params: { feedId?: number; unreadOnly?: boolean; search?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.feedId) query.set("feedId", String(params.feedId));
    if (params.unreadOnly) query.set("unreadOnly", "true");
    if (params.search) query.set("search", params.search);
    const qs = query.toString();
    return request<Item[]>(`/items${qs ? `?${qs}` : ""}`);
  },
  markRead: (itemId: number) => request<void>(`/items/${itemId}/read`, { method: "POST" }),
  markUnread: (itemId: number) => request<void>(`/items/${itemId}/unread`, { method: "POST" }),
  markAllRead: (feedId?: number) =>
    request<{ marked: number }>("/items/mark-all-read", { method: "POST", body: JSON.stringify({ feedId }) }),

  listTokens: () => request<Token[]>("/tokens"),
  createToken: (name: string) =>
    request<{ id: number; token: string }>("/tokens", { method: "POST", body: JSON.stringify({ name }) }),
  deleteToken: (id: number) => request<void>(`/tokens/${id}`, { method: "DELETE" }),
};
