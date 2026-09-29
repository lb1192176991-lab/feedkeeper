import { Router } from "express";
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
  isUserSubscribed,
  updateItemFullContent,
} from "../feeds/repository.js";
import { extractArticleFromUrl, isCachedConsentSnippet } from "../feeds/extractor.js";

export const itemsRouter = Router();
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
});

itemsRouter.get("/", (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const items = listItemsForUser(req.user!.id, parsed.data);
  res.json(
    items.map((item) => ({
      ...item,
      read: Boolean(item.read),
      bookmarked: Boolean(item.bookmarked),
    })),
  );
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
  bookmarkItem(req.user!.id, Number(req.params.itemId));
  res.status(204).end();
});

itemsRouter.delete("/:itemId/bookmark", (req, res) => {
  unbookmarkItem(req.user!.id, Number(req.params.itemId));
  res.status(204).end();
});

itemsRouter.post("/:itemId/extract-content", async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    res.status(400).json({ error: "invalid_item_id" });
    return;
  }

  const item = findItemById(itemId);
  if (!item || !isUserSubscribed(req.user!.id, item.feed_id)) {
    res.status(404).json({ error: "item_not_found" });
    return;
  }

  const force = req.query.force === "true";

  // If already extracted and not forced, return cached version unless it was an old saved consent banner
  if (!force && item.full_content_html && !isCachedConsentSnippet(item.full_content_html)) {
    res.json({
      id: item.id,
      full_content_html: item.full_content_html,
      cached: true,
    });
    return;
  }

  if (!item.link) {
    res.status(400).json({ error: "item_has_no_link" });
    return;
  }

  try {
    const extracted = await extractArticleFromUrl(item.link);
    if (!extracted || !extracted.contentHtml) {
      res.status(422).json({ error: "could_not_extract_content" });
      return;
    }

    updateItemFullContent(itemId, extracted.contentHtml);

    res.json({
      id: item.id,
      full_content_html: extracted.contentHtml,
      title: extracted.title,
      byline: extracted.byline,
      cached: false,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "extraction_failed", message: msg });
  }
});
