import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type Feed } from "../api/client.ts";

const POLL_PRESETS = [5, 15, 30, 60, 180, 360, 720, 1440];

function formatInterval(t: (key: string, opts?: Record<string, unknown>) => string, minutes: number): string {
  if (minutes < 60) return t("feeds.minutesShort", { count: minutes });
  return t("feeds.hoursShort", { count: Math.round(minutes / 60) });
}

export function FeedsPage() {
  const { t, i18n } = useTranslation();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [editingFeedId, setEditingFeedId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editInterval, setEditInterval] = useState(15);

  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  const [refreshingAll, setRefreshingAll] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setFeeds(await api.listFeeds());
    } finally {
      setLoading(false);
    }
  }

  async function onRefreshFeed(feedId: number) {
    setRefreshingIds((prev) => new Set(prev).add(feedId));
    try {
      const res = await api.refreshFeed(feedId);
      if (res.feed) {
        setFeeds((prev) => prev.map((f) => (f.id === feedId ? res.feed : f)));
      } else {
        await load();
      }
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(feedId);
        return next;
      });
    }
  }

  async function onRefreshAll() {
    setRefreshingAll(true);
    try {
      await api.refreshAllFeeds();
      await load();
    } finally {
      setRefreshingAll(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.subscribeFeed(url, label || null);
      setUrl("");
      setLabel("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onUnsubscribe(feed: Feed) {
    const title = feed.label ?? feed.title ?? feed.url;
    if (!confirm(t("feeds.unsubscribeConfirm", { title }))) return;
    await api.unsubscribeFeed(feed.id);
    await load();
  }

  function startEdit(feed: Feed) {
    setEditingFeedId(feed.id);
    setEditLabel(feed.label ?? "");
    setEditInterval(feed.poll_interval_minutes);
  }

  async function saveEdit(feedId: number) {
    await api.updateFeed(feedId, { label: editLabel || null, pollIntervalMinutes: editInterval });
    setEditingFeedId(null);
    await load();
  }

  async function onMarkAllRead(feed: Feed) {
    await api.markAllRead(feed.id);
    await load();
  }

  async function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportMessage(null);

    try {
      const text = await file.text();
      const res = await api.importOpml(text);
      if (res.failed > 0) {
        setImportMessage({
          type: "success",
          text: t("feeds.importPartial", { imported: res.imported, skipped: res.skipped, failed: res.failed }),
        });
      } else {
        setImportMessage({
          type: "success",
          text: t("feeds.importSuccess", { imported: res.imported, skipped: res.skipped }),
        });
      }
      await load();
    } catch {
      setImportMessage({ type: "error", text: t("feeds.importFailed") });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const dateFormatter = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("feeds.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefreshAll}
            disabled={refreshingAll || loading}
            className="btn-secondary text-sm inline-flex items-center gap-1.5"
          >
            <span className={refreshingAll ? "animate-spin" : ""}>↻</span>
            {refreshingAll ? t("feeds.refreshing") : t("feeds.refreshAll")}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileSelected}
            accept=".opml,.xml,text/xml,application/xml"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="btn-secondary text-sm"
          >
            {importing ? t("feeds.importing") : t("feeds.importOpml")}
          </button>
          <a
            href={api.exportOpmlUrl()}
            download="feedkeeper-subscriptions.opml"
            className="btn-secondary text-sm inline-flex items-center"
          >
            {t("feeds.exportOpml")}
          </a>
        </div>
      </div>

      {importMessage && (
        <div
          className={`card p-3 text-sm flex items-center justify-between border ${
            importMessage.type === "error" ? "text-red-500 border-red-500/30" : ""
          }`}
          style={importMessage.type === "success" ? { borderColor: "var(--c-green3)", color: "var(--c-green3)" } : undefined}
        >
          <span>{importMessage.text}</span>
          <button
            type="button"
            onClick={() => setImportMessage(null)}
            className="text-xs ml-3 underline opacity-80 hover:opacity-100 cursor-pointer"
          >
            {t("common.close")}
          </button>
        </div>
      )}

      <form onSubmit={onSubmit} className="card p-4 flex flex-col sm:flex-row gap-3">
        <input
          type="url"
          required
          placeholder={t("feeds.urlPlaceholder")}
          className="input sm:flex-1"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          type="text"
          placeholder={t("feeds.labelPlaceholder")}
          className="input sm:w-56"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="submit" disabled={submitting} className="btn-primary whitespace-nowrap">
          {t("feeds.subscribe")}
        </button>
      </form>
      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading ? (
        <p style={{ color: "var(--c-text-muted)" }}>{t("common.loading")}</p>
      ) : feeds.length === 0 ? (
        <p style={{ color: "var(--c-text-muted)" }}>{t("feeds.noFeeds")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {feeds.map((feed) => {
            const isFailing = Boolean(feed.last_error);
            const isPending = !feed.last_polled_at;
            const isRefreshing = refreshingIds.has(feed.id);

            return (
              <li
                key={feed.id}
                className="card p-4 flex flex-col gap-3 transition-colors"
                style={{
                  borderLeft: isFailing
                    ? "4px solid #ef4444"
                    : isPending
                    ? "4px solid var(--c-border)"
                    : "4px solid var(--c-green3)",
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                        title={
                          isFailing
                            ? t("feeds.statusFailing", { count: feed.consecutive_errors || 1 })
                            : isPending
                            ? t("feeds.statusPending")
                            : t("feeds.statusHealthy")
                        }
                        style={{
                          backgroundColor: isFailing
                            ? "#ef4444"
                            : isPending
                            ? "var(--c-text-muted)"
                            : "var(--c-green3)",
                        }}
                      />
                      <p className="font-medium truncate">{feed.label ?? feed.title ?? feed.url}</p>
                    </div>

                    <p className="text-sm truncate mt-0.5" style={{ color: "var(--c-text-muted)" }}>
                      {feed.url}
                    </p>

                    <div className="text-xs mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: "var(--c-text-muted)" }}>
                      <span>
                        {t("feeds.lastPolled")}:{" "}
                        {feed.last_polled_at ? dateFormatter.format(new Date(feed.last_polled_at)) : t("common.never")}
                      </span>
                      <span>·</span>
                      <span>
                        {t("feeds.interval")}: {formatInterval(t, feed.poll_interval_minutes)}
                      </span>
                      {feed.last_success_at && isFailing && (
                        <>
                          <span>·</span>
                          <span>
                            {t("feeds.lastSuccess")}: {dateFormatter.format(new Date(feed.last_success_at))}
                          </span>
                        </>
                      )}
                    </div>

                    {feed.last_error && (
                      <div
                        className="mt-2 p-2.5 rounded text-xs border flex items-start gap-2"
                        style={{
                          backgroundColor: "rgba(239, 68, 68, 0.08)",
                          borderColor: "rgba(239, 68, 68, 0.25)",
                          color: "#f87171",
                        }}
                      >
                        <span className="font-semibold flex-shrink-0">⚠️ {t("feeds.error")}:</span>
                        <span className="font-mono break-all">{feed.last_error}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {feed.unread_count > 0 && (
                      <span
                        className="text-xs font-medium px-2 py-1 rounded-full"
                        style={{ backgroundColor: "var(--c-green3)", color: "#0f141e" }}
                      >
                        {t("feeds.unread", { count: feed.unread_count })}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => onRefreshFeed(feed.id)}
                      disabled={isRefreshing}
                      title={t("feeds.refreshFeed")}
                      className="btn-secondary text-sm inline-flex items-center gap-1"
                    >
                      <span className={isRefreshing ? "animate-spin" : ""}>↻</span>
                      <span className="hidden sm:inline">{isRefreshing ? t("feeds.refreshing") : t("feeds.refreshFeed")}</span>
                    </button>

                    {feed.unread_count > 0 && (
                      <button onClick={() => onMarkAllRead(feed)} className="btn-secondary text-sm whitespace-nowrap">
                        {t("feeds.markAllRead")}
                      </button>
                    )}
                    <button
                      onClick={() => (editingFeedId === feed.id ? setEditingFeedId(null) : startEdit(feed))}
                      className="btn-secondary text-sm"
                    >
                      {t("feeds.edit")}
                    </button>
                    <button onClick={() => onUnsubscribe(feed)} className="btn-secondary text-sm">
                      {t("feeds.unsubscribe")}
                    </button>
                  </div>
                </div>

              {editingFeedId === feed.id && (
                <div
                  className="flex flex-col sm:flex-row gap-3 pt-3 border-t"
                  style={{ borderColor: "var(--c-border)" }}
                >
                  <input
                    type="text"
                    placeholder={t("feeds.labelPlaceholder")}
                    className="input sm:flex-1"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                  />
                  <select
                    className="input sm:w-48"
                    value={editInterval}
                    onChange={(e) => setEditInterval(Number(e.target.value))}
                  >
                    {POLL_PRESETS.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {formatInterval(t, minutes)}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => saveEdit(feed.id)} className="btn-primary text-sm whitespace-nowrap">
                    {t("common.save")}
                  </button>
                </div>
              )}
            </li>
          );
        })}
        </ul>
      )}
    </div>
  );
}
