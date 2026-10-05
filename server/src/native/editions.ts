import { hasUserCapability } from "../auth/capabilities.js";
import { randomUUID } from "node:crypto";
import cron from "node-cron";
import { z } from "zod";
import { db } from "../db/index.js";
import { canAccessItem } from "../feeds/repository.js";
import { decodeEntities } from "../feeds/text.js";
import { editionPeriod, nextEditionBoundary, selectEdition, type EditionCandidate } from "./editionSelection.js";
import { getNativePreferences } from "./preferences.js";
import { NativeError, nativeRequest } from "./requests.js";

export const overviewSchema = z.array(z.object({
  heading: z.string().trim().min(1).max(160),
  segments: z.array(z.object({
    text: z.string().min(1).max(1000),
    itemId: z.number().int().positive().optional(),
  }).strict()).min(1).max(20),
}).strict()).min(1).max(5).refine((blocks) =>
  blocks.reduce((sum, block) => sum + block.heading.length + block.segments.reduce((n, segment) => n + segment.text.length, 0), 0) <= 3000,
  "Overview text must not exceed 3000 characters");
export type EditionOverviewInput = z.infer<typeof overviewSchema>;
export type EditionOverview = (EditionOverviewInput[number] & { id: string })[];

export interface ServerEdition {
  id: string;
  revision: number;
  source: "automatic" | "curated";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  period: "morning" | "midday" | "evening" | "late";
  title: string | null;
  summary: string | null;
  overview: EditionOverview | null;
  preferencesRevision: number;
  itemIds: number[];
}
interface EditionRow {
  user_id: number;
  edition_id: string;
  revision: number;
  source: ServerEdition["source"];
  status: "active" | "expired" | "dismissed";
  created_at: string;
  updated_at: string;
  expires_at: string;
  period: string | null;
  title: string | null;
  summary: string | null;
  overview: string | null;
  preferences_revision: number;
  item_ids: string;
}
export interface EditionState {
  revision: number;
  status: "none" | "active" | "expired" | "dismissed";
  edition: ServerEdition | null;
}

function storedEdition(userId: number): EditionRow | undefined {
  return db.prepare<[number], EditionRow>("SELECT * FROM editions WHERE user_id = ?").get(userId);
}
function serialize(row: EditionRow): ServerEdition {
  const prefs = getNativePreferences(row.user_id);
  return {
    id: row.edition_id, revision: row.revision, source: row.source,
    createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at,
    period: (row.period?.split(":")[1] as ServerEdition["period"] | undefined) ?? editionPeriod(new Date(row.created_at), prefs.timeZone).period,
    title: row.title, summary: row.summary, overview: row.overview ? JSON.parse(row.overview) : null, preferencesRevision: row.preferences_revision,
    itemIds: JSON.parse(row.item_ids),
  };
}
export function getEditionState(userId: number, now = new Date()): EditionState {
  const row = storedEdition(userId);
  if (!row) return { revision: 0, status: "none", edition: null };
  const status = row.status === "active" && Date.parse(row.expires_at) <= now.getTime() ? "expired" : row.status;
  return { revision: row.revision, status, edition: status === "active" ? serialize(row) : null };
}
export function getEdition(userId: number, now = new Date()): ServerEdition | null {
  return getEditionState(userId, now).edition;
}
function checkRevision(userId: number, expectedRevision: number | undefined, now: Date): void {
  const current = getEditionState(userId, now);
  if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new NativeError("revision_conflict", 409, current);
}
function writeEdition(userId: number, itemIds: number[], source: ServerEdition["source"], expiry: Date, now: Date, title: string | null = null, summary: string | null = null, overview: EditionOverviewInput | null = null): ServerEdition {
  const prefs = getNativePreferences(userId);
  const id = randomUUID();
  const revision = (storedEdition(userId)?.revision ?? 0) + 1;
  const created = now.toISOString();
  db.prepare(`INSERT INTO editions (user_id, edition_id, item_ids, revision, source, status, created_at, updated_at, expires_at, period, title, summary, preferences_revision, overview)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET edition_id = excluded.edition_id, item_ids = excluded.item_ids,
      revision = excluded.revision, source = excluded.source, status = 'active', created_at = excluded.created_at,
      updated_at = excluded.updated_at, expires_at = excluded.expires_at, period = excluded.period,
      title = excluded.title, summary = excluded.summary, preferences_revision = excluded.preferences_revision, overview = excluded.overview`)
    .run(userId, id, JSON.stringify(itemIds), revision, source, created, created, expiry.toISOString(), editionPeriod(now, prefs.timeZone).key, title, summary, prefs.revision, overview ? JSON.stringify(overview.map((block, index) => ({ id: `topic-${index + 1}`, ...block }))) : null);
  db.prepare("INSERT INTO edition_history (user_id, edition_id, item_ids, revision, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, id, JSON.stringify(itemIds), revision, created);
  db.prepare(`DELETE FROM edition_history WHERE user_id = ? AND edition_id NOT IN
    (SELECT edition_id FROM edition_history WHERE user_id = ? ORDER BY revision DESC LIMIT 32)`)
    .run(userId, userId);
  return serialize(storedEdition(userId)!);
}

export const publishEditionFields = {
  itemIds: z.array(z.number().int().positive()).min(1).max(24),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  durationHours: z.number().positive().max(168).optional(),
  expectedRevision: z.number().int().min(0).optional(),
  requestId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().min(1).max(2000).optional(),
  overview: overviewSchema.optional(),
};
const publishSchema = z.object(publishEditionFields).strict().refine((input) => !(input.expiresAt && input.durationHours), "Use expiresAt or durationHours, not both");
export type PublishEditionInput = z.infer<typeof publishSchema>;

/** Both automatic and MCP editions obey the app's hard exclusions. Read/saved articles
 * may be selected deliberately by an agent, but foreign and muted items cannot be published. */
export function publishCuratedEdition(userId: number, input: PublishEditionInput, now = new Date()): ServerEdition {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) throw new NativeError("invalid_input");
  const { requestId, ...data } = parsed.data;
  return nativeRequest(userId, requestId, "edition.publish", data, () => {
    checkRevision(userId, data.expectedRevision, now);
    if (new Set(data.itemIds).size !== data.itemIds.length) throw new NativeError("duplicate_item_ids");
    if (data.overview?.some((block) => !block.segments.some((segment) => segment.itemId !== undefined) ||
      block.segments.some((segment) => segment.itemId !== undefined && !data.itemIds.includes(segment.itemId)))) {
      throw new NativeError("invalid_overview_reference");
    }
    const prefs = getNativePreferences(userId);
    for (const id of data.itemIds) {
      if (!canAccessItem(userId, id)) throw new NativeError("item_not_found", 404);
      const item = db.prepare<[number, number, number], { folder_id: number | null; subscribed: number; muted: number }>(
        `SELECT s.folder_id, s.id IS NOT NULL AS subscribed,
          EXISTS (SELECT 1 FROM user_muted_keywords m WHERE m.user_id = ? AND
            (instr(lower(coalesce(i.title, '')), lower(m.keyword)) > 0 OR instr(lower(coalesce(i.content_snippet, '')), lower(m.keyword)) > 0)) AS muted
         FROM items i LEFT JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ? WHERE i.id = ?`,
      ).get(userId, userId, id)!;
      if (item.muted || (item.subscribed && (item.folder_id === null ? !prefs.showUnfiled : prefs.hiddenFolderIds.includes(item.folder_id)))) {
        throw new NativeError("item_excluded");
      }
    }
    const expiry = data.expiresAt ? new Date(data.expiresAt) : new Date(now.getTime() + (data.durationHours ?? 24) * 3_600_000);
    if (expiry.getTime() <= now.getTime() || expiry.getTime() > now.getTime() + 168 * 3_600_000) throw new NativeError("invalid_expiry");
    return writeEdition(userId, data.itemIds, "curated", expiry, now, data.title ?? null, data.summary ?? (data.overview?.map((block) => `${block.heading}: ${block.segments.map((segment) => segment.text).join("")}`).join("\n\n").slice(0, 2000).replace(/[\uD800-\uDBFF]$/, "") ?? null), data.overview ?? null);
  }, now);
}

/** Compatibility entry point for existing internal callers. New agents supply a
 * request ID and expected revision to publishCuratedEdition. */
export function publishEdition(userId: number, itemIds: number[], expiresAt?: string | null): ServerEdition {
  return publishCuratedEdition(userId, { itemIds, ...(expiresAt ? { expiresAt } : {}) });
}

export function dismissEdition(userId: number, input: { expectedRevision?: number; requestId?: string } = {}, now = new Date()): EditionState {
  return nativeRequest(userId, input.requestId, "edition.dismiss", { expectedRevision: input.expectedRevision }, () => {
    checkRevision(userId, input.expectedRevision, now);
    const row = storedEdition(userId);
    if (row && row.status !== "dismissed") {
      db.prepare("UPDATE editions SET status = 'dismissed', revision = revision + 1, updated_at = ?, period = ? WHERE user_id = ?")
        .run(now.toISOString(), editionPeriod(now, getNativePreferences(userId).timeZone).key, userId);
    }
    return getEditionState(userId, now);
  }, now);
}
export function deleteEdition(userId: number): boolean {
  const existed = Boolean(getEdition(userId));
  dismissEdition(userId);
  return existed;
}

export function editionCandidates(userId: number, now = new Date(), limit = 200): EditionCandidate[] {
  const prefs = getNativePreferences(userId);
  const previous = new Set(db.prepare<[number, string], { item_ids: string }>(
    "SELECT item_ids FROM edition_history WHERE user_id = ? AND created_at >= ?",
  ).all(userId, new Date(now.getTime() - 72 * 3_600_000).toISOString()).flatMap((row) => JSON.parse(row.item_ids) as number[]));
  // Fetch bounded candidates per source, so a busy feed cannot hide the others.
  const rows = db.prepare<[number, number, number, string, string], {
    id: number; feed_id: number; folder_id: number | null; title: string | null; link: string | null;
    content_snippet: string | null; image_url: string | null; published: string; content_chars: number; source_name: string | null; folder_name: string | null;
  }>(`SELECT * FROM (
      SELECT i.id, i.feed_id, s.folder_id, i.title, i.link, i.content_snippet, i.image_url,
        coalesce(s.label, f.title) AS source_name, folders.name AS folder_name,
        strftime('%Y-%m-%dT%H:%M:%fZ', coalesce(julianday(i.published_at), julianday(i.created_at))) AS published,
        length(coalesce(i.full_content_html, i.content_html, i.content_snippet, '')) AS content_chars,
        row_number() OVER (PARTITION BY i.feed_id ORDER BY coalesce(julianday(i.published_at), julianday(i.created_at)) DESC, i.id DESC) AS source_rank
      FROM items i JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?
      JOIN feeds f ON f.id = i.feed_id LEFT JOIN folders ON folders.id = s.folder_id
      WHERE NOT EXISTS (SELECT 1 FROM item_reads r WHERE r.item_id = i.id AND r.user_id = ?)
        AND NOT EXISTS (SELECT 1 FROM user_muted_keywords m WHERE m.user_id = ? AND
          (instr(lower(coalesce(i.title, '')), lower(m.keyword)) > 0 OR instr(lower(coalesce(i.content_snippet, '')), lower(m.keyword)) > 0))
        AND coalesce(julianday(i.published_at), julianday(i.created_at)) BETWEEN julianday(?) AND julianday(?)
    ) WHERE source_rank <= 40 ORDER BY source_rank, published DESC, id DESC LIMIT 4000`)
    .all(userId, userId, userId, new Date(now.getTime() - 7 * 86_400_000).toISOString(), now.toISOString());
  const scored: EditionCandidate[] = rows.filter((row) => row.folder_id === null ? prefs.showUnfiled : !prefs.hiddenFolderIds.includes(row.folder_id))
    .map((row) => ({
      id: row.id, sourceName: row.source_name, folderName: row.folder_name, subscriptionId: row.feed_id, folderId: row.folder_id,
      title: row.title, url: row.link, publishedAt: row.published, snippet: decodeEntities(row.content_snippet) ?? null, imageUrl: row.image_url,
      readingMinutes: Math.max(1, Math.ceil(row.content_chars / 1400)), previouslySelected: previous.has(row.id),
      score: Math.pow(0.5, Math.max(0, now.getTime() - Date.parse(row.published)) / (18 * 3_600_000)) *
        (row.folder_id !== null && prefs.preferredFolderIds.includes(row.folder_id) ? 1.4 : 1),
    }));
  // Candidate requests expose a diversified shortlist rather than only the busiest source.
  if (limit < scored.length) {
    const sorted = selectEdition(scored, { ...prefs, editionSize: Math.min(limit, 24), readingMinutes: null });
    const selected = new Set(sorted.map((item) => item.id));
    return [...sorted, ...scored.filter((item) => !selected.has(item.id)).sort((a, b) => b.score - a.score || b.id - a.id)].slice(0, limit);
  }
  return scored.sort((a, b) => b.score - a.score || b.id - a.id);
}

export const generateEditionSchema = z.object({
  requestId: z.uuid(),
  expectedRevision: z.number().int().min(0).optional(),
  force: z.boolean().default(false),
}).strict().refine((input) => !input.force || input.expectedRevision !== undefined, "force requires expectedRevision");

export function generateEdition(userId: number, input: { requestId?: string; expectedRevision?: number; force?: boolean } = {}, now = new Date()): ServerEdition | null {
  return nativeRequest(userId, input.requestId, "edition.generate", { expectedRevision: input.expectedRevision, force: input.force ?? false }, () => {
    checkRevision(userId, input.expectedRevision, now);
    const prefs = getNativePreferences(userId);
    const period = editionPeriod(now, prefs.timeZone).key;
    const state = getEditionState(userId, now);
    if (state.edition) {
      if (state.edition.source === "curated") {
        if (input.force) throw new NativeError("curated_edition_active", 409, state);
        return state.edition;
      }
      if (!input.force) return state.edition;
    }
    const row = storedEdition(userId);
    if (!input.force && row?.status === "dismissed" && row.period === period) return null;
    if (row?.status === "active" && !state.edition) {
      db.prepare("UPDATE editions SET status = 'expired', revision = revision + 1, updated_at = ? WHERE user_id = ?").run(now.toISOString(), userId);
    }
    const chosen = selectEdition(editionCandidates(userId, now, 4000), prefs);
    if (!chosen.length) return state.edition;
    if (state.edition && JSON.stringify(state.edition.itemIds) === JSON.stringify(chosen.map((item) => item.id))) return state.edition;
    return writeEdition(userId, chosen.map((item) => item.id), "automatic", nextEditionBoundary(now, prefs.timeZone), now);
  }, now);
}

/** Only users who opted in by storing preferences or creating an edition are scheduled. */
export function maintainEditions(now = new Date()): void {
  const users = db.prepare<[], { user_id: number }>(
    "SELECT user_id FROM native_preferences UNION SELECT user_id FROM editions",
  ).all();
  for (const user of users) {
    if (!hasUserCapability(user.user_id, "editions")) continue;
    try { generateEdition(user.user_id, {}, now); }
    catch (error) { console.error("[edition] could not refresh an edition", error instanceof Error ? error.message : "unknown error"); }
  }
  // Receipts remain valid for at least 35 days, beyond the native offline window.
  db.prepare("DELETE FROM native_requests WHERE created_at < ?").run(new Date(now.getTime() - 35 * 86_400_000).toISOString());
}
export function startEditionScheduler(): void {
  maintainEditions();
  cron.schedule("* * * * *", () => maintainEditions());
}
