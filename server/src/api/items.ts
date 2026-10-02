import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireSession } from "../auth/middleware.js";
import {
  listItemsForUser,
  markAllRead,
  markItemRead,
  markItemUnread,
  bookmarkItem,
  unbookmarkItem,
  findItemById,
} from "../feeds/repository.js";
import { loadFullText, type FullTextError } from "../feeds/fullText.js";
import { fetchItemImage, pruneArchive, scheduleArchive, withArchivedImages, withProxiedImages } from "../feeds/archive.js";

const FULL_TEXT_STATUS: Record<FullTextError, number> = {
  item_not_found: 404,
  item_has_no_link: 400,
  full_text_disabled: 409,
  consent_wall: 422,
  could_not_extract_content: 422,
  extraction_failed: 502,
};

export const itemsRouter = Router();

// The origin the browser used (honours TRUST_PROXY), so archive URLs work behind proxies and in development.
function requestOrigin(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}
itemsRouter.use(requireSession);

const listQuerySchema = z.object({
  feedId: z.coerce.number().int().positive().optional(),
  folderId: z.coerce.number().int().positive().optional(),
  unreadOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  bookmarkedOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  includeMuted: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  offline: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});

itemsRouter.get("/", (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  // Saved articles are served with their archived images instead of the originals.
  const origin = requestOrigin(req);
  const archived = withArchivedImages(listItemsForUser(req.user!.id, parsed.data), origin);
  // Offline copies also get the images of articles that are not archived, through this server.
  const items = parsed.data.offline ? withProxiedImages(archived, origin) : archived;
  res.json(
    items.map((item) => ({
      ...item,
      read: Boolean(item.read),
      bookmarked: Boolean(item.bookmarked),
    })),
  );
});

const imageLimiter = rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });

// Lets the web app keep an article's images for offline reading; only images the article itself shows are served.
itemsRouter.get("/:itemId/image", imageLimiter, async (req, res) => {
  const src = typeof req.query.src === "string" ? req.query.src : "";
  try {
    const image = await fetchItemImage(req.user!.id, Number(req.params.itemId), src);
    if (image === "forbidden") {
      res.status(404).json({ error: "not_found" });
    } else if (image === "unsupported") {
      res.status(415).json({ error: "unsupported_image" });
    } else {
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.type(image.mime).send(image.buffer);
    }
  } catch {
    res.status(502).json({ error: "image_unavailable" });
  }
});

const markAllReadSchema = z.object({
  feedId: z.number().int().positive().optional(),
  folderId: z.number().int().positive().optional(),
});

itemsRouter.post("/mark-all-read", (req, res) => {
  const parsed = markAllReadSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const count = markAllRead(req.user!.id, { feedId: parsed.data.feedId, folderId: parsed.data.folderId });
  res.json({ marked: count });
});

itemsRouter.post("/:itemId/read", (req, res) => {
  markItemRead(req.user!.id, Number(req.params.itemId));
  res.status(204).end();
});

itemsRouter.post("/:itemId/unread", (req, res) => {
  markItemUnread(req.user!.id, Number(req.params.itemId));
  res.status(204).end();
});

itemsRouter.post("/:itemId/bookmark", (req, res) => {
  const itemId = Number(req.params.itemId);
  if (bookmarkItem(req.user!.id, itemId) > 0) scheduleArchive(itemId);
  res.status(204).end();
});

itemsRouter.delete("/:itemId/bookmark", (req, res) => {
  if (unbookmarkItem(req.user!.id, Number(req.params.itemId)) > 0) pruneArchive();
  res.status(204).end();
});

itemsRouter.post("/:itemId/extract-content", async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    res.status(400).json({ error: "invalid_item_id" });
    return;
  }

  const result = await loadFullText(req.user!.id, itemId, { force: req.query.force === "true" });
  if (!result.ok) {
    res.status(FULL_TEXT_STATUS[result.error]).json({ error: result.error, ...(result.message ? { message: result.message } : {}) });
    return;
  }

  const [served] = withArchivedImages([{ id: result.id, link: findItemById(result.id)?.link ?? null, full_content_html: result.fullContentHtml }], requestOrigin(req));
  res.json({
    id: result.id,
    full_content_html: served.full_content_html,
    ...(result.cached ? {} : { title: result.title, byline: result.byline }),
    cached: result.cached,
  });
});
