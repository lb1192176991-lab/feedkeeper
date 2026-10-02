# Native client API (design draft)

Status: draft, nothing here is implemented yet. This document fixes the decisions behind `/api/v1`, the API for native apps, so the server, the iOS app and later third-party clients can be built against one contract.

## Goals

- A stable, versioned API for native apps that does not depend on cookies or on what the web UI happens to need.
- Offline-first clients: complete sync of subscriptions, articles and state, with changes queued on the device and replayed safely.
- Everything FeedKeeper offers beyond classic readers is a first-class part of the API: the permanent archive of saved articles, per-feed notification and badge settings, highlights and notes, tags, reading position.
- Push notifications for the iOS app without exposing article content to anyone but the user's own server and device.
- Third-party apps can use the same API. A Google Reader compatible layer for existing apps is a separate, later adapter on top of the same services.

Non-goals: replacing the web app's API right away (it can move to `/api/v1` later), federation, multi-server accounts.

## Conventions

- Base path `/api/v1`, JSON over HTTPS, UTF-8. Timestamps are ISO 8601 in UTC. IDs are integers and never reused.
- Errors: `{ "error": "<code>", "message": "<human readable>", "details": … }` with a matching HTTP status. Codes are stable strings.
- Pagination uses opaque cursors (`nextCursor`), never offsets.
- `Idempotency-Key` header on every unsafe request that is not part of `/mutations`. Replaying a request with the same key returns the stored result.
- Responses are gzip-compressed and carry `ETag` where cheap, so clients can revalidate lists.
- Rate limits are per token and returned in `RateLimit-*` headers; sync endpoints have higher limits than the web API.
- The contract is an OpenAPI 3.1 file, `docs/openapi.yaml`, kept next to the code; a test fails when it and the implemented routes drift apart. The Swift client is generated from it and a conformance test suite runs against a real server.

## Meta and compatibility

`GET /api/v1/meta` (no authentication) returns the server's identity and abilities:

```json
{
  "apiVersion": 1,
  "serverVersion": "0.9.0",
  "features": ["sync", "archive", "annotations", "tags", "fulltext", "push.relay", "search.fts"],
  "limits": { "maxMutationsPerRequest": 200, "retentionDays": 90, "maxArchivedImageBytes": 5242880 },
  "minClientVersion": null
}
```

Clients read `features` instead of guessing from the version, so an app can support servers that lag behind. New fields are added without a version bump; breaking changes get `/api/v2` and the old version stays for at least one major release.

## Authentication and device pairing

Each app installation is a **device** with its own revocable token.

1. In the web settings the user taps "Add a device". The server creates a single-use **pairing code** (valid 10 minutes, one active code per user; creating a new one replaces the old one). The code carries about 60 bits and the pairing endpoint is rate limited per address, so guessing is not practical and shows it as a QR code containing `feedkeeper://pair?server=<url>&code=<code>`.
2. The app scans the code (or the user types server address and code) and calls `POST /api/v1/devices/pair` with the code, a device name and platform.
3. The response contains the device token, shown to the app once. It is sent as `Authorization: Bearer fk_dev_…`.
4. Tokens are stored hashed. The web settings list devices with name, platform, last seen and a revoke button. Revoking removes the token, the push registration and the device's queued state.

Scopes: `read` and `write`, as for the existing personal access tokens. Devices are normally `write`. The existing `personal_access_tokens` table is reused with a `kind` column (`api` or `device`) and device metadata; the MCP endpoint keeps accepting its tokens unchanged. OIDC login (planned separately) only changes how the web session is created; pairing works the same afterwards. Because iOS blocks plain HTTP by default, the app documents that HTTPS is required, with an exception for local network addresses.

## Data model additions

New tables (migrations are additive and keep existing data):

| Table | Purpose |
|---|---|
| `changes` | Per-user change log for state, compacted: one row per `user_id`, `entity`, `entity_id` (unique), holding `op` (`upsert` or `delete`) and a `seq` that is reassigned on every change. |
| `applied_mutations` | `user_id`, `mutation_id`, `applied_at`, result; makes `/mutations` idempotent. Pruned after 30 days. |
| `annotations` | Highlights and notes: `id`, `user_id`, `item_id`, `quote`, `prefix`, `suffix`, `content_hash`, `note`, `color`, `revision`, `created_at`, `updated_at`, `deleted_at`. |
| `tags` | `id`, `user_id`, `name` (unique per user), `color`. |
| `item_tags` | `user_id`, `item_id`, `tag_id`. |
| `item_progress` | Reading position per user and article, for every article: `position` 0..1, `updated_at`. Removed together with the article. |
| `devices` metadata | Columns on the token table: `kind`, `platform`, `app_version`, `last_seen_at`, `push_relay_token`, `push_key`. |

Article content stays global (one row per article, shared by subscribers); everything personal is a per-user row, as today.

## Sync

Two streams, because articles and personal state behave differently.

**Content stream (articles).** An article is created once for all subscribers, so it must not fan out into per-user change rows. Clients page through `GET /items?after=<cursor>` in "added" order, the same cursor idea as the MCP `list_items`. Each item carries its state (`read`, `saved`, tags, progress). Deletions caused by retention are not announced: `/meta.limits.retentionDays` and the per-feed item cap are public, and the client applies the same retention locally. Saved articles are never purged, so they are never dropped by this rule.

**State stream (per user).** Everything personal and small goes through the change log:

`GET /sync?since=<seq>&limit=500` →

```json
{
  "changes": [
    { "seq": 4121, "entity": "item_state", "id": 107255, "op": "upsert", "data": { "read": true, "saved": true, "savedAt": "…", "progress": 0.4 } },
    { "seq": 4122, "entity": "subscription", "id": 12, "op": "upsert", "data": { "…": "…" } },
    { "seq": 4123, "entity": "annotation", "id": 9, "op": "delete" }
  ],
  "nextSeq": 4123,
  "hasMore": false
}
```

Entities: `item_state` (read, saved, saved time, reading position), `subscription`, `folder`, `muted_keyword`, and later `annotation`, `tag` and `item_tag`. The log is filled by database triggers, so every code path (web app, MCP, native API) is covered. A "mark all read" produces one `item_state` entry per article it touches; compaction keeps that bounded. Feed-level data that changes on every poll (title, icon, health, unread counts) is deliberately not part of the log; clients refresh it with `GET /subscriptions` and compute unread counts from their own copy.

The log is **compacted**: each object has exactly one row whose `seq` moves forward when the object changes, so toggling an article read and unread three times leaves one entry and the log grows with the number of objects, not the number of changes. Only deletions (tombstones) are remembered for 90 days. A client that is new, or whose `since` is older than the oldest remembered tombstone, gets `410 resync_required` and starts over: it drops its copy of this state and syncs from `since=0`. Because the log holds one entry per object, `since=0` *is* the complete state, so there is no separate snapshot endpoint. Users whose data predates the log are added to it on their first sync.

## Mutations from the device

`POST /mutations` takes up to 200 changes made offline, each with a client-generated UUID:

```json
{ "mutations": [
  { "id": "6f1c…", "type": "item.read", "itemId": 107255, "value": true, "at": "2026-10-02T08:01:00Z" },
  { "id": "9a02…", "type": "item.save", "itemId": 107255, "value": true, "at": "…" },
  { "id": "c7d3…", "type": "annotation.create", "itemId": 107255, "quote": "…", "prefix": "…", "suffix": "…", "note": "…" }
] }
```

The server applies them in order and answers per mutation (`applied`, `duplicate`, `stale`, `rejected` with a code). Replays are harmless thanks to `applied_mutations`. Conflict rules: read, saved and reading position are last-writer-wins **per field** by `at`. The log records when each field last changed, whether through a device or the web app, and an older change is answered `stale` and not applied. `at` may be at most 5 minutes ahead of the server clock (it is clamped) and at most 30 days old (older is `rejected`). Reading positions below 5 % or above 95 % clear the stored position; annotations carry a `revision` and an edit based on an old revision is rejected with `409 revision_conflict`, returning the current version for the client to merge. A rejected mutation never blocks the rest of the batch.

## Resources

All of these require a device token unless noted. Lists are cursor-paged.

**Account and settings**
- `GET /me`, `GET /devices`, `DELETE /devices/{id}`, `POST /devices/pair` (no auth, needs a code), `POST /pairing-codes` (web session).
- `GET /overview`: unread counts per feed and folder, saved count, failing feeds. Cheap enough for widgets and the app badge.

**Subscriptions and folders**
- `GET /subscriptions`, `POST /subscriptions` (URL or website, with discovery as today), `PATCH /subscriptions/{id}` (label, folder, poll interval, full-text mode, `notify`, `badge`), `DELETE /subscriptions/{id}`, `POST /subscriptions/{id}/refresh`, `POST /discover`.
- `GET /subscriptions/{id}/icon` (cacheable image), OPML import and export.
- `GET/POST/PATCH/DELETE /folders`.

**Articles**
- `GET /items` (filters: feed, folder, unread, saved, tag, date range, `after` cursor), `GET /items/{id}`.
- Item fields: `id`, `subscriptionId`, `title`, `url`, `author`, `publishedAt`, `addedAt`, `snippet`, `imageUrl`, `contentHtml`, `fullTextHtml`, `state` (`read`, `saved`, `savedAt`, `archivedAt`, `progress`, `tags`), `contentHash` of the archived full text.
- `POST /items/{id}/full-text` fetches and caches the full article.
- `GET /items/bundle?ids=…` returns articles with all content and a map of image URLs, so a client can store an offline copy with one request. `GET /items/{id}/image?src=…` serves an article's images and `GET /archive/images/{id}` the stored copies of saved articles. Both the web app and the native API call the route `image`, so there is one name for it.
- `GET /search?q=…` searches titles, summaries, archived full text, notes and tags (SQLite FTS5, planned alongside).

**Saved articles, tags, annotations, progress**
- Saving is state (`item.save`). It triggers the archive on the server; `archivedAt` appears once full text and images are stored. Saving is what makes highlights and tags possible.
- `GET/POST /tags`, tagging via mutation `item.tag`. Tags exist only on saved articles; unsaving removes the tags.
- `GET /items/{id}/annotations`, plus mutations `annotation.create|update|delete`. Annotations are allowed on saved articles only, because their archived full text no longer changes. An annotation anchors with a text quote selector (exact text, a few characters of prefix and suffix) plus the `contentHash` it was made against; clients re-anchor by quote and fall back to showing it unanchored if the text is gone.
- `item.progress` stores the reading position of **any** article so another device can continue where you stopped. Clients send it batched: when leaving the article or at most every 10 seconds. The server ignores positions below 5 % and above 95 %, since "not started" and "finished" are covered by the read state.
- `GET /items/{id}/annotations.md` and `GET /annotations/export` return highlights and notes as Markdown (quote, note, article title and link), so notes are never locked in and can be fed into tools such as Obsidian.

**Keywords**
- `GET/POST/DELETE /muted-keywords`.

## Push notifications for the iOS app

Web Push (used by the PWA) does not reach native apps, and the APNs signing key belongs to the app's publisher, so a self-hosted server cannot talk to Apple directly. A **push relay**, operated by the app's publisher, sits between the server and APNs. Its source is not part of this repository; the protocol between server and relay is.

```
FeedKeeper server ──(encrypted payload, relay token)──▶ Relay ──(APNs)──▶ iPhone
                                                                      └─ Notification Service Extension decrypts and shows it
```

1. The app obtains its APNs device token and registers it with the relay: `POST /v1/registrations` with the token, the environment (production or sandbox) and an **App Attest** assertion, so only genuine installations of the paid app can register. The relay answers with an opaque `relayToken`.
2. The app creates a random symmetric key and sends `relayToken` and the key to its own server: `PUT /api/v1/devices/me/push`. The server never sees the APNs token.
3. When a feed with notifications switched on has new articles, the server sends `POST /v1/notify` to the relay, authenticated with the `relayToken`. The body is a small envelope: ciphertext of `{ title, body, url, unread }` (AES-GCM with the device key), plus nothing else readable.
4. The relay maps the token to the APNs device token and sends a push with `mutable-content` and a generic placeholder text. The app's Notification Service Extension decrypts the envelope and replaces the text, sets the badge number and the deep link.
5. The relay stores only the mapping from relay token to APNs token and counts per-token usage for rate limits. It cannot read what it forwards. Invalid tokens reported by APNs are deleted and the next `notify` answers `410`, so the server removes the registration.

The relay address is a server setting (`PUSH_RELAY_URL`, default the publisher's relay), so the open-source server works with the relay but does not depend on closed code to build or run. Servers without a relay simply offer no native push.

## What this enables in the app

Offline copy of saved and recent articles with images, instant state sync across devices, per-feed notification and badge settings, highlights and notes on saved articles, tags, reading position handoff, widgets fed by `/overview`, a share extension that calls `POST /subscriptions`, Siri shortcuts and Spotlight search over the local copy.

## Phases

Status: steps 1 and 2 are implemented (pairing, `/meta`, change log, `/sync`, `/mutations`, subscriptions, folders, keywords, articles, images, OPML, `docs/openapi.yaml`). Annotations, tags, FTS5 search and the push relay are still to do. Route names follow the OpenAPI file, for example `/muted-keywords`, `/items/{id}/image` and `/items/read-all`.

1. Contract: OpenAPI file, error catalogue, review of this draft.
2. Server foundations: device tokens and pairing, `/meta`, change log and `/sync`, `/mutations`, subscriptions and articles on `/api/v1` with tests.
3. Saved-article features: tags, annotations, reading position, FTS5 search, `bundle` and the image routes.
4. Push: relay protocol on the server side, device registration, the relay service and the app's extension.
5. Google Reader compatible adapter for third-party apps, built on the same services.

## Decisions

- Reading position syncs for every article, batched by the client and filtered by the server.
- Pairing codes live 10 minutes, one per user, with a limit on wrong attempts.
- The change log is compacted per object; only deletions are remembered for 90 days.
- Highlights and notes can be exported as Markdown from the start.
