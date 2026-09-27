import { config } from "../config.js";
import {
  createFeed,
  findFeedByUrl,
  isUserSubscribed,
  subscribe,
  unsubscribe as unsubscribeRepo,
  listSubscriptionsForUser,
  updateSubscriptionLabel,
  updateFeedPollInterval,
  type SubscribedFeed,
} from "./repository.js";
import { pollFeed } from "./poller.js";
import { assertPublicHttpUrl } from "./ssrfGuard.js";

import { discoverFeeds } from "./discovery.js";

export class FeedError extends Error {}
export class MultipleFeedsFoundError extends FeedError {
  constructor(public feeds: Array<{ url: string; title: string | null; type: string }>) {
    super("multiple_feeds_found");
    this.name = "MultipleFeedsFoundError";
  }
}

export async function subscribeToFeed(
  userId: number,
  url: string,
  label: string | null,
): Promise<SubscribedFeed> {
  const validated = await assertPublicHttpUrl(url);
  let targetUrl = validated.toString();

  // Try auto-discovery in case the user entered a website URL instead of a direct feed URL
  try {
    const discovered = await discoverFeeds(targetUrl);
    if (discovered.length === 1) {
      targetUrl = discovered[0].url;
    } else if (discovered.length > 1) {
      // If none of them exactly match what was entered, notify caller of multiple choices
      const exact = discovered.find((d) => d.url === targetUrl);
      if (exact) {
        targetUrl = exact.url;
      } else {
        throw new MultipleFeedsFoundError(discovered);
      }
    }
  } catch (err) {
    if (err instanceof FeedError) throw err;
    // Otherwise fallback to trying the given targetUrl directly
  }

  let feed = findFeedByUrl(targetUrl);
  if (!feed) {
    feed = createFeed(targetUrl, Math.max(config.minPollIntervalMinutes, 15));
  }

  if (isUserSubscribed(userId, feed.id)) {
    throw new FeedError("already_subscribed");
  }

  subscribe(userId, feed.id, label);

  // Fetch immediately so the user sees items right away instead of waiting
  // for the next scheduler tick.
  await pollFeed(feed);

  const subscription = listSubscriptionsForUser(userId).find((s) => s.id === feed!.id);
  if (!subscription) throw new FeedError("subscription_lookup_failed");
  return subscription;
}

export function unsubscribeFromFeed(userId: number, feedId: number): void {
  if (!isUserSubscribed(userId, feedId)) {
    throw new FeedError("not_subscribed");
  }
  unsubscribeRepo(userId, feedId);
}

export function updateFeedSettings(
  userId: number,
  feedId: number,
  settings: { label?: string | null; pollIntervalMinutes?: number },
): SubscribedFeed {
  if (!isUserSubscribed(userId, feedId)) {
    throw new FeedError("not_subscribed");
  }

  if (settings.label !== undefined) {
    updateSubscriptionLabel(userId, feedId, settings.label);
  }

  if (settings.pollIntervalMinutes !== undefined) {
    // The poll interval is stored per feed (shared across every subscriber),
    // so it's floored account-wide rather than trusting each caller's input.
    const minutes = Math.max(settings.pollIntervalMinutes, config.minPollIntervalMinutes);
    updateFeedPollInterval(feedId, minutes);
  }

  const subscription = listSubscriptionsForUser(userId).find((s) => s.id === feedId);
  if (!subscription) throw new FeedError("subscription_lookup_failed");
  return subscription;
}
