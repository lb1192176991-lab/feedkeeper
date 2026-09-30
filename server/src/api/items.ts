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
} from "../feeds/repository.js";
import { loadFullText } from "../feeds/fullText.js";

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

  const result = await loadFullText(req.user!.id, itemId, { force: req.query.force === "true" });
  if (!result.ok) {
    const status = { item_not_found: 404, item_has_no_link: 400, could_not_extract_content: 422, extraction_failed: 502 }[result.error];
    res.status(status).json({ error: result.error, ...(result.message ? { message: result.message } : {}) });
    return;
  }

  res.json({
    id: result.id,
    full_content_html: result.fullContentHtml,
    ...(result.cached ? {} : { title: result.title, byline: result.byline }),
    cached: result.cached,
  });
});
