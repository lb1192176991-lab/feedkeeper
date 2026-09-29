import { config } from "../config.js";
import {
  createFeed,
  findFeedByUrl,
  isUserSubscribed,
  subscribe,
  unsubscribe as unsubscribeRepo,
  listSubscriptionsForUser,
  updateSubscriptionLabel,
  updateSubscriptionFolder,
  updateFeedPollInterval,
  findFolderById,
  type SubscribedFeed,
} from "./repository.js";
import { pollFeed } from "./poller.js";
import { assertPublicHttpUrl } from "./ssrfGuard.js";

import { discoverFeeds } from "./discovery.js";

export class FeedError extends Error {}
export class NoFeedsFoundError extends FeedError {
  constructor() {
    super("no_feeds_found");
    this.name = "NoFeedsFoundError";
  }
}
export class MultipleFeedsFoundError extends FeedError {
  constructor(public feeds: Array<{ url: string; title: string | null; type: string }>) {
    super("multiple_feeds_found");
    this.name = "MultipleFeedsFoundError";
  }
}

export async function subscribeToFeed(
  userId: number,
  inputUrl: string,
  label: string | null = null,
  folderId: number | null = null,
): Promise<SubscribedFeed> {
  if (folderId !== null && !findFolderById(userId, folderId)) {
    throw new FeedError("folder_not_found");
  }
  const validated = await assertPublicHttpUrl(inputUrl.trim());
  let targetUrl = validated.toString();
  let hadDiscoverySuccess = false;

  // Try auto-discovery in case the user entered a website URL instead of a direct feed URL
  try {
    const discovered = await discoverFeeds(targetUrl);
    if (discovered.length === 1) {
      targetUrl = discovered[0].url;
      hadDiscoverySuccess = true;
    } else if (discovered.length > 1) {
      const exact = discovered.find((d) => d.url === targetUrl);
      if (exact) {
        targetUrl = exact.url;
        hadDiscoverySuccess = true;
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

  subscribe(userId, feed.id, label, folderId);

  // Fetch immediately so the user sees items right away instead of waiting
  // for the next scheduler tick.
  const pollResult = await pollFeed(feed);

  // If auto-discovery didn't find anything and the initial poll of this URL failed,
  // roll back the subscription so we don't keep dead/non-feed URLs around:
  if (!hadDiscoverySuccess && pollResult.error && !feed.title) {
    unsubscribeRepo(userId, feed.id);
    throw new NoFeedsFoundError();
  }

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
  settings: { label?: string | null; folderId?: number | null; pollIntervalMinutes?: number },
): SubscribedFeed {
  if (!isUserSubscribed(userId, feedId)) {
    throw new FeedError("not_subscribed");
  }

  if (settings.label !== undefined) {
    updateSubscriptionLabel(userId, feedId, settings.label);
  }

  if (settings.folderId !== undefined) {
    if (settings.folderId !== null && !findFolderById(userId, settings.folderId)) {
      throw new FeedError("folder_not_found");
    }
    updateSubscriptionFolder(userId, feedId, settings.folderId);
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
