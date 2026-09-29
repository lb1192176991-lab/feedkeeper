import { useEffect, useRef, useState, useMemo, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError, type Feed, type Folder, type DiscoveredFeed } from "../api/client.ts";
import { CustomSelect, type SelectOption } from "../components/CustomSelect.tsx";
import { LoadingSpinner } from "../components/LoadingSpinner.tsx";

const POLL_PRESETS = [5, 15, 30, 60, 180, 360, 720, 1440];

function formatInterval(t: (key: string, opts?: Record<string, unknown>) => string, minutes: number): string {
  if (minutes < 60) return t("feeds.minutesShort", { count: minutes });
  return t("feeds.hoursShort", { count: Math.round(minutes / 60) });
}

export function FeedsPage() {
  const { t, i18n } = useTranslation();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [manageFoldersOpen, setManageFoldersOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderSubmitting, setFolderSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discoveredCandidates, setDiscoveredCandidates] = useState<DiscoveredFeed[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [editingFeedId, setEditingFeedId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editLabelChanged, setEditLabelChanged] = useState(false);
  const [editFolderId, setEditFolderId] = useState<number | null>(null);
  const [editInterval, setEditInterval] = useState(15);

  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  const [refreshingAll, setRefreshingAll] = useState(false);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const folderOptions = useMemo<SelectOption[]>(() => {
    return [
      { value: "", label: t("feeds.noFolder") },
      ...folders.map((f) => ({ value: String(f.id), label: f.name })),
    ];
  }, [folders, t]);

  const intervalOptions = useMemo<SelectOption[]>(() => {
    return POLL_PRESETS.map((minutes) => ({
      value: String(minutes),
      label: formatInterval(t, minutes),
    }));
  }, [t]);

  async function handleDragEnd() {
    if (draggedIndex === null || dragOverIndex === null || draggedIndex === dragOverIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const updated = [...feeds];
    const [moved] = updated.splice(draggedIndex, 1);
    updated.splice(dragOverIndex, 0, moved);

    setFeeds(updated);
    setDraggedIndex(null);
    setDragOverIndex(null);

    try {
      await api.reorderFeeds(updated.map((f) => f.id));
    } catch (err) {
      console.error("Failed to save feed order:", err);
      await load();
    }
  }

  async function load() {
    setLoading(true);
    try {
      const [feedsData, foldersData] = await Promise.all([
        api.listFeeds(),
        api.listFolders().catch(() => ({ folders: [] })),
      ]);
      setFeeds(feedsData);
      setFolders(foldersData.folders);
    } catch (err) {
      console.error("Failed to load feeds:", err);
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

  async function subscribeWithUrl(targetUrl: string, customLabel?: string | null) {
    setSubmitting(true);
    setError(null);
    setDiscoveredCandidates([]);
    try {
      await api.subscribeFeed(
        targetUrl,
        customLabel !== undefined ? customLabel : (label || null),
        selectedFolderId,
      );
      setUrl("");
      setLabel("");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "multiple_feeds_found" && err.data && typeof err.data === "object" && "feeds" in err.data) {
          const feedsList = (err.data as { feeds: DiscoveredFeed[] }).feeds;
          setDiscoveredCandidates(feedsList);
          return;
        }
        if (err.code === "already_subscribed") {
          setError(t("feeds.alreadySubscribed"));
          return;
        }
        if (err.code === "no_feeds_found" || err.code === "invalid_feed") {
          setError(t("feeds.noFeedsFoundOnPage"));
          return;
        }
      }
      setError(err instanceof ApiError ? err.code : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    let target = url.trim();
    if (target && !/^https?:\/\//i.test(target)) {
      target = target.startsWith("//") ? `https:${target}` : `https://${target}`;
    }
    await subscribeWithUrl(target);
  }

  async function onUnsubscribe(feed: Feed) {
    const title = feed.label ?? feed.title ?? feed.url;
    if (!confirm(t("feeds.unsubscribeConfirm", { title }))) return;
    await api.unsubscribeFeed(feed.id);
    await load();
  }

  function startEdit(feed: Feed) {
    setEditingFeedId(feed.id);
    setEditLabel(feed.label?.trim() || feed.title?.trim() || feed.url);
    setEditLabelChanged(false);
    setEditFolderId(feed.folder_id ?? null);
    setEditInterval(feed.poll_interval_minutes);
  }

  async function saveEdit(feedId: number) {
    await api.updateFeed(feedId, {
      ...(editLabelChanged ? { label: editLabel.trim() || null } : {}),
      folderId: editFolderId,
      pollIntervalMinutes: editInterval,
    });
    setEditingFeedId(null);
    await load();
  }

  async function onCreateFolder(e: FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setFolderSubmitting(true);
    try {
      const folder = await api.createFolder(newFolderName.trim());
      const newFolder: Folder = {
        ...folder,
        feed_count: folder.feed_count ?? 0,
        unread_count: folder.unread_count ?? 0,
      };
      setFolders((prev) => [...prev, newFolder].sort((a, b) => a.name.localeCompare(b.name)));
      setNewFolderName("");
    } finally {
      setFolderSubmitting(false);
    }
  }

  async function onDeleteFolder(folder: Folder) {
    if (!confirm(t("feeds.deleteFolderConfirm", { name: folder.name }))) return;
    await api.deleteFolder(folder.id);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("feeds.title")}</h1>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setManageFoldersOpen((prev) => !prev)}
            className="btn-secondary text-sm inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            {t("feeds.manageFolders")}
          </button>
          <button
            type="button"
            onClick={onRefreshAll}
            disabled={refreshingAll || loading}
            className="btn-secondary text-sm inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <svg
              className={`w-3.5 h-3.5 ${refreshingAll ? "animate-spin" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
            </svg>
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
            className="btn-secondary text-sm text-center whitespace-nowrap"
          >
            {importing ? t("feeds.importing") : t("feeds.importOpml")}
          </button>
          <a
            href={api.exportOpmlUrl()}
            download="feedkeeper-subscriptions.opml"
            className="btn-secondary text-sm inline-flex items-center justify-center text-center whitespace-nowrap"
          >
            {t("feeds.exportOpml")}
          </a>
        </div>
      </div>

      {manageFoldersOpen && (
        <div className="card p-4 flex flex-col gap-4 border" style={{ borderColor: "var(--c-blue1)" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">{t("feeds.manageFolders")}</h2>
            <button
              type="button"
              onClick={() => setManageFoldersOpen(false)}
              className="p-1 rounded-md text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)] transition-colors cursor-pointer"
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <form onSubmit={onCreateFolder} className="flex gap-2">
            <input
              type="text"
              placeholder={t("feeds.newFolderPlaceholder")}
              className="input flex-1 text-sm"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
            />
            <button
              type="submit"
              disabled={folderSubmitting || !newFolderName.trim()}
              className="btn-primary text-sm whitespace-nowrap"
            >
              {t("feeds.addFolder")}
            </button>
          </form>

          {folders.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--c-text-muted)" }}>
              {t("feeds.noFolder")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {folders.map((folder) => (
                <li
                  key={folder.id}
                  className="flex items-center justify-between gap-3 p-2.5 rounded border bg-[var(--c-bg)]"
                  style={{ borderColor: "var(--c-border)" }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm truncate">{folder.name}</span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "var(--c-border)", color: "var(--c-text-muted)" }}
                    >
                      {folder.feed_count ?? 0}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteFolder(folder)}
                    className="w-5 h-5 rounded-full btn-danger-circle flex items-center justify-center shrink-0 cursor-pointer shadow-xs"
                    title={t("common.delete")}
                    aria-label={t("common.delete")}
                  >
                    <svg
                      className="w-3 h-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {importMessage && (
        <div
          className="card p-3 text-sm flex items-center justify-between border"
          style={
            importMessage.type === "success"
              ? { borderColor: "var(--c-green3)", color: "var(--c-green3)" }
              : { borderColor: "var(--c-danger-border)", backgroundColor: "var(--c-danger-bg)", color: "var(--c-danger)" }
          }
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
          type="text"
          required
          placeholder={t("feeds.urlPlaceholder")}
          className="input sm:flex-1"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (discoveredCandidates.length > 0) setDiscoveredCandidates([]);
          }}
        />
        <input
          type="text"
          placeholder={t("feeds.labelPlaceholder")}
          className="input sm:w-48"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <CustomSelect
          value={selectedFolderId ? String(selectedFolderId) : ""}
          onChange={(val) => setSelectedFolderId(val ? Number(val) : null)}
          options={folderOptions}
          className="w-full sm:w-44 shrink-0"
          placeholder={t("feeds.noFolder")}
        />
        <button type="submit" disabled={submitting} className="btn-primary whitespace-nowrap">
          {submitting ? t("feeds.subscribing") : t("feeds.subscribe")}
        </button>
      </form>

      {discoveredCandidates.length > 0 && (
        <div className="card p-4 border flex flex-col gap-3" style={{ borderColor: "var(--c-blue1)" }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t("feeds.multipleFeedsFound")}</p>
            <button
              type="button"
              onClick={() => setDiscoveredCandidates([])}
              className="text-xs underline opacity-80 hover:opacity-100"
            >
              {t("common.close")}
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {discoveredCandidates.map((candidate) => (
              <li
                key={candidate.url}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg border bg-[var(--c-bg)]"
                style={{ borderColor: "var(--c-border)" }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{candidate.title ?? candidate.url}</p>
                  <p className="text-xs truncate" style={{ color: "var(--c-text-muted)" }}>
                    {candidate.url}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => subscribeWithUrl(candidate.url, candidate.title || label || null)}
                  className="btn-primary text-xs px-3 py-1.5 shrink-0 self-end sm:self-auto"
                >
                  {t("feeds.subscribe")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {loading ? (
        <LoadingSpinner size="lg" />
      ) : feeds.length === 0 ? (
        <p style={{ color: "var(--c-text-muted)" }}>{t("feeds.noFeeds")}</p>
      ) : (
        <ul className="flex flex-col gap-3 animate-page-fade">
          {feeds.map((feed, index) => {
            const isFailing = Boolean(feed.last_error);
            const isPending = !feed.last_polled_at;
            const isRefreshing = refreshingIds.has(feed.id);
            const isDragging = draggedIndex === index;
            const isDragOver = dragOverIndex === index && draggedIndex !== index;

            return (
              <li
                key={feed.id}
                draggable
                onDragStart={(e) => {
                  setDraggedIndex(index);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(feed.id));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverIndex !== index) {
                    setDragOverIndex(index);
                  }
                }}
                onDragEnd={handleDragEnd}
                className={`card p-4 flex flex-col gap-3 transition-all ${
                  isDragging ? "opacity-40 scale-[0.99]" : ""
                } ${isDragOver ? "ring-2 ring-[var(--c-blue1)]" : ""}`}
                style={{
                  borderLeft: isFailing
                    ? "4px solid #ef4444"
                    : isPending
                    ? "4px solid var(--c-border)"
                    : "4px solid var(--c-green3)",
                }}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                  <div className="min-w-0 flex-1 flex items-start gap-2.5">
                    {/* Drag handle */}
                    <div
                      className="cursor-grab active:cursor-grabbing text-[var(--c-text-muted)] hover:text-[var(--c-text)] shrink-0 pt-0.5"
                      title={t("feeds.dragHandle")}
                      aria-label={t("feeds.dragHandle")}
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="9" cy="5" r="1" />
                        <circle cx="9" cy="12" r="1" />
                        <circle cx="9" cy="19" r="1" />
                        <circle cx="15" cy="5" r="1" />
                        <circle cx="15" cy="12" r="1" />
                        <circle cx="15" cy="19" r="1" />
                      </svg>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
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
                        <Link
                          to={`/items?feed=${feed.id}`}
                          className="font-medium truncate text-base hover:underline text-[var(--c-text)]"
                          title={t("items.title")}
                        >
                          {feed.label ?? feed.title ?? feed.url}
                        </Link>
                        {feed.folder_name && (
                          <span
                            className="text-xs px-2 py-0.5 rounded border shrink-0"
                            style={{ borderColor: "var(--c-border)", color: "var(--c-text-muted)" }}
                          >
                            {feed.folder_name}
                          </span>
                        )}
                        {feed.unread_count > 0 && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--c-blue1)] text-white shrink-0">
                            {t("feeds.unread", { count: feed.unread_count })}
                          </span>
                        )}
                      </div>

                      <p className="text-xs sm:text-sm font-mono truncate mt-1" style={{ color: "var(--c-text-muted)" }}>
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
                          className="mt-2.5 p-2.5 rounded text-xs border flex items-start gap-2"
                          style={{
                            backgroundColor: "var(--c-danger-bg)",
                            borderColor: "var(--c-danger-border)",
                            color: "var(--c-danger)",
                          }}
                        >
                          <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                          </svg>
                          <div className="min-w-0">
                            <span className="font-semibold mr-1">{t("feeds.error")}:</span>
                            <span className="font-mono break-all">{feed.last_error}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2 pt-2.5 sm:pt-0 border-t sm:border-t-0 shrink-0 w-full sm:w-auto"
                    style={{ borderColor: "var(--c-border)" }}
                  >
                    <button
                      type="button"
                      onClick={() => onRefreshFeed(feed.id)}
                      disabled={isRefreshing}
                      title={t("feeds.refreshFeed")}
                      className="btn-secondary text-xs sm:text-sm inline-flex items-center gap-1.5 px-2.5 py-1.5"
                    >
                      <svg
                        className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
                      </svg>
                      <span>{isRefreshing ? t("feeds.refreshing") : t("feeds.refreshFeed")}</span>
                    </button>

                    {feed.unread_count > 0 && (
                      <button
                        type="button"
                        onClick={() => onMarkAllRead(feed)}
                        title={t("feeds.markAllRead")}
                        className="btn-secondary text-xs sm:text-sm inline-flex items-center gap-1.5 px-2.5 py-1.5 whitespace-nowrap"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span className="hidden md:inline">{t("feeds.markAllRead")}</span>
                        <span className="md:hidden">{t("feeds.markReadShort")}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => (editingFeedId === feed.id ? setEditingFeedId(null) : startEdit(feed))}
                      title={t("feeds.edit")}
                      className={`btn-secondary text-xs sm:text-sm inline-flex items-center gap-1.5 px-2.5 py-1.5 ${
                        editingFeedId === feed.id ? "ring-1 ring-[var(--c-blue3)] text-[var(--c-blue3)]" : ""
                      }`}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                      <span>{t("feeds.edit")}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onUnsubscribe(feed)}
                      title={t("feeds.unsubscribe")}
                      className="btn-secondary text-xs sm:text-sm inline-flex items-center gap-1.5 px-2.5 py-1.5 hover:text-[#7c2d12] dark:hover:text-[#f87171] hover:border-[#7c2d12]/40 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      <span className="hidden sm:inline">{t("feeds.unsubscribe")}</span>
                    </button>
                  </div>
                </div>

                {editingFeedId === feed.id && (
                  <div
                    className="mt-1 p-3 sm:p-4 rounded-lg border flex flex-col gap-3"
                    style={{
                      backgroundColor: "color-mix(in srgb, var(--c-surface) 92%, var(--c-blue1) 8%)",
                      borderColor: "var(--c-border)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--c-text-muted)]">
                        {t("feeds.editFeedTitle")}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingFeedId(null)}
                        className="p-1 rounded text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)] transition-colors cursor-pointer"
                        title={t("common.cancel")}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1 text-[var(--c-text-muted)]">
                          {t("feeds.labelPlaceholder")}
                        </label>
                        <input
                          type="text"
                          placeholder={t("feeds.labelPlaceholder")}
                          className="input"
                          value={editLabel}
                          onChange={(e) => {
                            setEditLabel(e.target.value);
                            setEditLabelChanged(true);
                          }}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium mb-1 text-[var(--c-text-muted)]">
                          {t("feeds.folder")}
                        </label>
                        <CustomSelect
                          value={editFolderId ? String(editFolderId) : ""}
                          onChange={(val) => setEditFolderId(val ? Number(val) : null)}
                          options={folderOptions}
                          className="w-full"
                          placeholder={t("feeds.noFolder")}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium mb-1 text-[var(--c-text-muted)]">
                          {t("feeds.interval")}
                        </label>
                        <CustomSelect
                          value={String(editInterval)}
                          onChange={(val) => setEditInterval(Number(val))}
                          options={intervalOptions}
                          className="w-full"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end items-center gap-2 pt-1 border-t" style={{ borderColor: "var(--c-border)" }}>
                      <button
                        type="button"
                        onClick={() => setEditingFeedId(null)}
                        className="btn-secondary text-sm px-3 py-1.5"
                      >
                        {t("common.cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(feed.id)}
                        className="btn-primary text-sm px-4 py-1.5"
                      >
                        {t("common.save")}
                      </button>
                    </div>
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
