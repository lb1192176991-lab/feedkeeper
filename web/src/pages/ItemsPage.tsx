import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Feed, type Item } from "../api/client.ts";

export function ItemsPage() {
  const { t, i18n } = useTranslation();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedId, setFeedId] = useState<number | "">("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.listFeeds().then(setFeeds);
  }, []);

  async function load() {
    setLoading(true);
    try {
      setItems(
        await api.listItems({
          feedId: feedId === "" ? undefined : feedId,
          unreadOnly,
          search: search || undefined,
        }),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = setTimeout(load, 200);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedId, unreadOnly, search]);

  async function toggleRead(item: Item) {
    if (item.read) await api.markUnread(item.id);
    else await api.markRead(item.id);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read: !i.read } : i)));
  }

  async function onMarkAllRead() {
    await api.markAllRead(feedId === "" ? undefined : feedId);
    await load();
  }

  const dateFormatter = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("items.title")}</h1>
        <button
          onClick={onMarkAllRead}
          className="btn-secondary text-sm whitespace-nowrap self-start sm:self-auto"
        >
          {t("feeds.markAllRead")}
        </button>
      </div>

      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          placeholder={t("items.searchPlaceholder")}
          className="input sm:flex-1"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input sm:w-56"
          value={feedId}
          onChange={(e) => setFeedId(e.target.value === "" ? "" : Number(e.target.value))}
        >
          <option value="">{t("items.allFeeds")}</option>
          {feeds.map((feed) => (
            <option key={feed.id} value={feed.id}>
              {feed.label ?? feed.title ?? feed.url}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap px-2 cursor-pointer select-none">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          {t("items.unreadOnly")}
        </label>
      </div>

      {loading ? (
        <p style={{ color: "var(--c-text-muted)" }}>{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--c-text-muted)" }}>{t("items.noItems")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="card p-4" style={{ opacity: item.read ? 0.6 : 1 }}>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs mb-1" style={{ color: "var(--c-text-muted)" }}>
                    {item.feed_title} ·{" "}
                    {item.published_at ? dateFormatter.format(new Date(item.published_at)) : ""}
                  </p>
                  <h2 className="font-medium text-base leading-snug">
                    {item.link ? (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline text-[var(--c-text)]"
                      >
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                  </h2>
                  {item.content_snippet && (
                    <p className="text-sm mt-1.5 line-clamp-3" style={{ color: "var(--c-text-muted)" }}>
                      {item.content_snippet}
                    </p>
                  )}
                </div>

                <div
                  className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 pt-2.5 sm:pt-0 border-t sm:border-t-0 shrink-0"
                  style={{ borderColor: "var(--c-border)" }}
                >
                  {item.link ? (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm underline text-[var(--c-blue1)] hover:opacity-80 inline-flex items-center gap-1"
                    >
                      {t("items.openLink")}
                      <span aria-hidden="true">↗</span>
                    </a>
                  ) : <div />}
                  <button
                    onClick={() => toggleRead(item)}
                    className="btn-secondary text-xs whitespace-nowrap px-3 py-1.5"
                  >
                    {item.read ? t("items.markUnread") : t("items.markRead")}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
