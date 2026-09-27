import { Router } from "express";
import { z } from "zod";
import { requireSession } from "../auth/middleware.js";
import { listSubscriptionsForUser, findFeedById, isUserSubscribed } from "../feeds/repository.js";
import { subscribeToFeed, unsubscribeFromFeed, updateFeedSettings, FeedError } from "../feeds/service.js";
import { SsrfBlockedError } from "../feeds/ssrfGuard.js";
import { generateOpml, importOpmlFeeds } from "../feeds/opml.js";
import { pollFeed } from "../feeds/poller.js";

export const feedsRouter = Router();
feedsRouter.use(requireSession);

feedsRouter.get("/", (req, res) => {
  res.json(listSubscriptionsForUser(req.user!.id));
});

feedsRouter.get("/opml", (req, res) => {
  const opml = generateOpml(req.user!.id);
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="feedkeeper-subscriptions.opml"');
  res.send(opml);
});

feedsRouter.post("/opml", async (req, res) => {
  const xmlContent =
    typeof req.body === "string"
      ? req.body
      : typeof req.body?.opml === "string"
        ? req.body.opml
        : null;

  if (!xmlContent || !xmlContent.trim()) {
    res.status(400).json({ error: "missing_opml_content" });
    return;
  }

  try {
    const result = await importOpmlFeeds(req.user!.id, xmlContent);
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: "invalid_opml",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

const subscribeSchema = z.object({
  url: z.string().url(),
  label: z.string().max(200).nullable().optional(),
});

feedsRouter.post("/", async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  try {
    const subscription = await subscribeToFeed(req.user!.id, parsed.data.url, parsed.data.label ?? null);
    res.status(201).json(subscription);
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      res.status(400).json({ error: "blocked_url", message: error.message });
      return;
    }
    if (error instanceof FeedError) {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: "invalid_feed", message: error instanceof Error ? error.message : String(error) });
  }
});

const updateSchema = z.object({
  label: z.string().max(200).nullable().optional(),
  pollIntervalMinutes: z.number().int().positive().max(10080).optional(),
});

feedsRouter.patch("/:feedId", (req, res) => {
  const feedId = Number(req.params.feedId);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  try {
    const subscription = updateFeedSettings(req.user!.id, feedId, parsed.data);
    res.json(subscription);
  } catch (error) {
    if (error instanceof FeedError) {
      res.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
});

feedsRouter.delete("/:feedId", (req, res) => {
  const feedId = Number(req.params.feedId);
  try {
    unsubscribeFromFeed(req.user!.id, feedId);
    res.status(204).end();
  } catch (error) {
    if (error instanceof FeedError) {
      res.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
});

feedsRouter.post("/:feedId/refresh", async (req, res) => {
  const feedId = Number(req.params.feedId);
  if (!Number.isInteger(feedId) || feedId <= 0) {
    res.status(400).json({ error: "invalid_feed_id" });
    return;
  }

  const feed = findFeedById(feedId);
  if (!feed || !isUserSubscribed(req.user!.id, feedId)) {
    res.status(404).json({ error: "feed_not_found" });
    return;
  }

  const pollResult = await pollFeed(feed);
  const updatedFeed = listSubscriptionsForUser(req.user!.id).find((f) => f.id === feedId);
  res.json({
    feed: updatedFeed,
    newItems: pollResult.newItems,
    error: pollResult.error,
  });
});

feedsRouter.post("/refresh-all", async (req, res) => {
  const subs = listSubscriptionsForUser(req.user!.id);
  let totalNewItems = 0;
  let errorCount = 0;

  for (const sub of subs) {
    const feed = findFeedById(sub.id);
    if (!feed) continue;
    const result = await pollFeed(feed);
    totalNewItems += result.newItems;
    if (result.error) errorCount++;
  }

  res.json({
    refreshed: subs.length,
    newItems: totalNewItems,
    errors: errorCount,
  });
});
