# Native client API

Status: the core `/api/v1` contract, including sync, notes, icons, editions and search, is implemented. Later ideas are marked as planned below. The implemented routes and schemas are specified in `docs/openapi.yaml`.

## Goals

- A stable, versioned API for native apps that does not depend on cookies or on what the web UI happens to need.
- Offline-first clients: complete sync of subscriptions, articles and state, with changes queued on the device and replayed safely.
- FeedKeeper features such as the permanent archive of saved articles, per-feed notification and badge settings, article notes and reading position are first-class parts of the API. Highlights and tags remain planned.
- Push notifications for the iOS app without exposing article content to anyone but the user's own server and device.
- Third-party apps can use the same API. A Google Reader compatible layer for existing apps is a separate, later adapter on top of the same services.

Non-goals: replacing the web app's API right away (it can move to `/api/v1` later), federation, multi-server accounts.

## Conventions

- Base path `/api/v1`, JSON over HTTPS, UTF-8. Timestamps are ISO 8601 in UTC. Resource IDs are integers and never reused; an edition also has an opaque string issue identity.
- Errors: `{ "error": "<code>", "message": "<human readable>", "details": … }` with a matching HTTP status. Codes are stable strings.
- Article lists use opaque cursors (`nextCursor`); full-text search uses `limit` and `offset`.
- Offline mutations use client-generated IDs for idempotent retries. Native preferences and edition commands use a `requestId` in the body; other writes do not currently support an `Idempotency-Key` header.
- Feed icons have `ETag` and `If-None-Match`; matching versioned icon URLs can be cached immutably.
- The implemented contract is described in the OpenAPI 3.1 file `docs/openapi.yaml`, kept next to the code.

## Meta and compatibility

`GET /api/v1/meta` (no authentication) returns the server's identity and abilities:

```json
{
  "apiVersion": 1,
  "serverVersion": "0.11.0",
  "features": ["pairing", "sync", "mutations", "subscriptions", "folders", "items", "fulltext", "images", "muted-keywords", "opml", "retention", "feed-icons", "folder-icons", "notes", "edition", "edition.automatic", "edition.revisions", "native-preferences", "search.fts"],
  "limits": { "maxMutationsPerRequest": 200, "retentionDays": 90, "retention": { "enabled": true, "readDays": 30, "maxDays": 90, "maxItemsPerFeed": 1000, "protectActiveEdition": true } },
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
| `item_notes` | Personal article notes with content, revision and timestamps. |
| `item_note_revisions` | Last revision after a note is deleted, so old edits and deletions cannot overwrite a recreated note. |
| `feed_icons` | Server-cached raster icons and content hashes for subscriptions. |
| `editions` | A user's current automatic or curated issue, identity, source, order, monotonic revision, status and expiry. The slot is retained after dismissal. |
| `edition_history` | The last 32 issues per user, for avoiding repeated selections within 72 hours. No article content is duplicated. |
| `native_preferences` | Revision-checked app-only section ordering, newspaper exclusions and edition preferences. |
| `native_requests` | Atomic receipts for preference and edition commands, retained for at least 35 days. |
| `item_progress` | Reading position per user and article, for every article: `position` 0..1, `updated_at`. Removed together with the article. |
| `devices` metadata | Columns on the token table: `kind`, `platform`, `app_version`, `last_seen_at`. Native push registration remains planned. |

Article content stays global (one row per article, shared by subscribers); everything personal is a per-user row, as today.

## Sync

Two streams, because articles and personal state behave differently.

**Content stream (articles).** An article is created once for all subscribers, so it must not fan out into per-user change rows. Clients page through `GET /items?after=<cursor>` in "added" order, the same cursor idea as the MCP `list_items`. Each item carries its state (`read`, `saved`, tags, progress). Deletions caused by retention are not announced: the cleanup rules are public in `/meta.limits.retention` (whether cleanup runs, the age limits for read and for all articles, and the per-feed cap; 0 switches a rule off), and the client applies the same retention locally. Saved and annotated articles are never purged. Active edition articles are protected until expiry or dismissal; clients observe `limits.retention.protectActiveEdition` and preserve the active item IDs locally.

**State stream (per user).** Everything personal and small goes through the change log:

`GET /sync?since=<seq>&limit=500` →

```json
{
  "changes": [
    { "seq": 4121, "entity": "item_state", "id": 107255, "op": "upsert", "data": { "read": true, "saved": true, "savedAt": "…", "progress": 0.4 } },
    { "seq": 4122, "entity": "subscription", "id": 12, "op": "upsert", "data": { "…": "…" } },
    { "seq": 4123, "entity": "note", "id": 9, "op": "delete", "data": { "revision": 4 } }
  ],
  "nextSeq": 4123,
  "hasMore": false
}
```

Entities: `item_state` (read, saved, saved time, reading position), `subscription`, `folder`, `muted_keyword`, `note`, `edition` and `native_preferences`. The log is filled by database triggers, so every code path (web app, MCP, native API) is covered. A "mark all read" produces one `item_state` entry per article it touches; compaction keeps that bounded. Changed feed icons produce a `subscription` upsert with a new `iconHash` and versioned `iconUrl`. Note deletions carry their new revision in `data`. Edition tombstones carry the retained revision and status; other deletions have no data. Feed health and unread counts are refreshed separately with `GET /subscriptions`.

The log is **compacted**: each object has exactly one row whose `seq` moves forward when the object changes, so toggling an article read and unread three times leaves one entry and the log grows with the number of objects, not the number of changes. Only deletions (tombstones) are remembered for 90 days. A client that is new, or whose `since` is older than the oldest remembered tombstone, gets `410 resync_required` and starts over: it drops its copy of this state and syncs from `since=0`. Because the log holds one entry per object, `since=0` *is* the complete state, so there is no separate snapshot endpoint. Users whose data predates the log are added to it on their first sync.

## Mutations from the device

`POST /mutations` takes up to 200 changes made offline, each with a client-generated UUID:

```json
{ "mutations": [
  { "id": "6f1c…", "type": "item.read", "itemId": 107255, "value": true, "at": "2026-10-02T08:01:00Z" },
  { "id": "9a02…", "type": "item.save", "itemId": 107255, "value": true, "at": "…" },
  { "id": "c7d3…", "type": "item.note.delete", "itemId": 107255, "expectedRevision": 3, "at": "…" }
] }
```

The server applies them in order and answers per mutation (`applied`, `duplicate`, `stale`, `rejected` or `conflict`). Replays are harmless thanks to `applied_mutations`. Conflict rules: read, saved and reading position are last-writer-wins **per field** by `at`. The log records when each field last changed, whether through a device or the web app, and an older change is answered `stale` and not applied. `at` may be at most 5 minutes ahead of the server clock (it is clamped) and at most 30 days old (older is `rejected`). Reading positions below 5 % or above 95 % clear the stored position. Notes use `expectedRevision` on both set and delete; a mismatch returns `revision_conflict` with the current state, including the tombstone revision after deletion. A rejected mutation never blocks the rest of the batch.

## Resources

Implemented routes accept device tokens or personal access tokens unless noted. The OpenAPI file gives the exact parameters and response shapes.

**Account and settings**
- `GET /me`, `GET /devices`, `DELETE /devices/{id}`, `POST /devices/pair` (no auth, needs a code), `POST /pairing-codes` (web session).
- `GET /overview`: unread counts per feed and folder, saved count, failing feeds. Cheap enough for widgets and the app badge.

**Subscriptions and folders**
- `GET /subscriptions`, `POST /subscriptions` (URL or website, with discovery as today), `PATCH /subscriptions/{id}` (label, folder, poll interval, full-text mode, `notify`, `badge`), `DELETE /subscriptions/{id}`, `POST /subscriptions/{id}/refresh`, `POST /discover`.
- `GET /subscriptions/{id}/icon` (cacheable image), OPML import and export.
- `GET/POST/PATCH/DELETE /folders`.

**Articles**
- `GET /items` (filters include subscription, folder, unread, saved and an `after` cursor), `GET /items/{id}`.
- Item fields include `id`, `subscriptionId`, `title`, `url`, `publishedAt`, `addedAt`, `snippet`, `imageUrl`, `contentHtml`, `fullTextHtml` and `state` (`read`, `saved`, `savedAt`, `archivedAt`, `progress`, `hasNote`).
- `POST /items/{id}/full-text` fetches and caches the full article.
- `GET /items/bundle?ids=…` returns articles with all content and a map of image URLs, so a client can store an offline copy with one request. `GET /items/{id}/image?src=…` serves an article's images and `GET /archive/images/{id}` the stored copies of saved articles. Both the web app and the native API call the route `image`, so there is one name for it.
- `GET /search?q=…` searches titles, summaries, cached full text and personal article notes with SQLite FTS5.

**Saved articles, notes and progress**
- Saving is state (`item.save`). It triggers the archive on the server; `archivedAt` appears once full text and images are stored. Personal notes can be attached to any accessible article.
- `GET/PUT/DELETE /items/{id}/note` and `item.note.set|delete` mutations synchronize personal Markdown notes. With `expectedRevision`, edits and deletions use optimistic concurrency. A deletion advances the revision, and a recreation advances it again. `GET` returns `404 note_not_found` with `current` tombstone state when no active note exists.
- `item.progress` stores the reading position of **any** article so another device can continue where you stopped. Clients send it batched: when leaving the article or at most every 10 seconds. The server ignores positions below 5 % and above 95 %, since "not started" and "finished" are covered by the read state.
- `GET /items/{id}/note.md` and `GET /notes/export` return Markdown with article title and link.

**Planned: highlights and tags**
- Tags on saved articles and anchored highlights are design ideas; their routes and mutations are not part of the current `/api/v1` contract.

**Keywords**
- `GET/POST/DELETE /muted-keywords`.

**Native Extensions**

- **Authoritative Feed Icons (`feed-icons`)**:
  - The server persists icons in `feed_icons` with SHA-256 content hashes (`iconHash` in API responses). Discovery prefers SVG artwork, then the largest declared raster icons, including Apple touch icons and icons from linked web app manifests. Failed candidates fall back to the next declared image, the previous source, then `/favicon.ico`. Monochrome mask icons are excluded. SVG sources are rendered to 512-pixel-wide PNGs; ICO sources use their largest embedded image. Raster sources retain their original resolution, with a 1 MiB download limit. All clients use the same cached image.
  - `/api/v1/subscriptions/{id}/icon` supports `ETag`, `If-None-Match` (304), and immutable caching (`Cache-Control: private, max-age=31536000, immutable`) when requested with matching `?v=<iconHash>`.
  - Feed polls recheck icons roughly once a week, including on a 304 feed response. A changed image logs a `subscription` upsert with updated `iconHash` and versioned `iconUrl`; unchanged images do not advance the sync log. Icons stored as SVG or ICO before 0.10.1 are converted when first requested.

- **Ressort / Folder SF Symbols (`folder-icons`)**:
  - Folders in the backend and API map to *Categories* (*Kategorien*) in the Web UI and *Ressorts* in the native app.
  - `folders.icon_symbol` stores an SF Symbol identifier (e.g. `newspaper.fill`, `cpu`).
  - Validated with `/^[a-z0-9]+(?:[\.\-][a-z0-9]+)*$/i`.
  - Supported on `POST /folders` and `PATCH /folders/{id}`. Renaming preserves existing `iconSymbol`.
  - Sync log delivers `folder` upserts with `iconSymbol`.
  - Migration strategy for native clients: on first launch, native clients query `GET /folders` and assign SF Symbols to existing unassigned folders via `PATCH /folders/{id}`.

- **Synchronized Article Notes (`notes`)**:
  - `item_notes` stores personal Markdown notes per article (`userId`, `itemId`, `content`, `revision`, `createdAt`, `updatedAt`).
  - `item_note_revisions` preserves the last revision after deletion. `PUT` and `DELETE /items/{id}/note` and both note mutations accept `expectedRevision`; conflicts include `current` with `deleted`, nullable content and the latest revision. Omitting `expectedRevision` keeps unconditional writes for older clients.
  - A missing note returns `404 note_not_found` with its current tombstone state. A note deletion in `/sync` includes `{ "revision": <number> }` in `data`, so a client can recreate it with the right revision.
  - Markdown exports: `GET /items/{id}/note.md` (single note with title and link) and `GET /notes/export` (all user notes in single Markdown document).
  - Retention protection: articles with notes are permanently excluded from database retention cleanup (`runCleanup`), even after feed unsubscription or age limit expiration.
  - Item listing endpoints (`/items`, `/items/{id}`, `/items/bundle`, `/edition`) include `state.hasNote: boolean`.

- **Shared Edition „Deine Zeitung“ (`edition`, `edition.automatic`, `edition.revisions`)**:
  - The server creates automatic issues; an active MCP-curated issue takes priority until expiry or dismissal.
  - `GET /edition` returns populated articles in preserved order; `/edition/state` returns the retained revision even after expiry or dismissal. Reads never generate an issue.
  - `POST /edition/generate` ensures an issue exists or requests a new automatic selection. UUID request IDs make retries safe; forced generation requires a revision.
  - `publish_edition` accepts a conditional revision, UUID request ID, optional title and summary, and a future expiry (default 24 hours, maximum seven days).
  - `GET/PATCH /native-preferences` syncs app-only folder order, newspaper visibility and selection preferences. It has no effect on the web folder list or article stream.
  - See [editions.md](editions.md) for defaults, lifecycle, scheduler, MCP workflow, first-time adoption and offline handling.

- **SQLite FTS5 Full-Text Search (`search.fts`)**:
  - Migration `0020_fts.sql` adds virtual table `items_fts` (`title`, `content_snippet`, `content_html`, `full_content_html`) with `unicode61 remove_diacritics 2` tokenization, backed by database triggers on `items` for insert, update, delete.
  - Endpoint `GET /api/v1/search?q=...` searches titles, snippets, cached full content and personal notes (`item_notes`).
  - Supports filters (`subscriptionId`, `folderId`, `unread`, `saved`, `limit`, `offset`), ranking by BM25 relevance (`sort=relevance`) or publication date (`sort=date`), image proxying, and content hydration (`include=content`).


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

Status: pairing, `/meta`, change log, `/sync`, `/mutations`, subscriptions, folders, keywords, articles, images, OPML, notes, editions, FTS5 search and `docs/openapi.yaml` are implemented. Highlights, tags and the native push relay remain planned. Route names follow the OpenAPI file, for example `/muted-keywords`, `/items/{id}/image` and `/items/read-all`.

1. Contract: OpenAPI file, error catalogue, review of this draft.
2. Server foundations: device tokens and pairing, `/meta`, change log and `/sync`, `/mutations`, subscriptions and articles on `/api/v1` with tests.
3. Saved-article features: reading position, FTS5 search, notes, `bundle` and the image routes are implemented; tags and highlights are planned.
4. Push: relay protocol on the server side, device registration, the relay service and the app's extension.
5. Google Reader compatible adapter for third-party apps, built on the same services.

## Decisions

- Reading position syncs for every article, batched by the client and filtered by the server.
- Pairing codes live 10 minutes, one per user, with a limit on wrong attempts.
- The change log is compacted per object; only deletions are remembered for 90 days.
- Highlights and notes can be exported as Markdown from the start.
