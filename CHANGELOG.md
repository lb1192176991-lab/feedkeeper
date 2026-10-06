# Changelog

All notable changes to FeedKeeper are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/) for its releases. The full release notes, including upgrade notes, are on the [releases page](https://github.com/visualfusion/feedkeeper/releases).

## [Unreleased]

## [0.14.2] - 2026-10-06

### Fixed
- `TRUST_PROXY` accepts a comma-separated list of trusted proxies (addresses, CIDR ranges, `loopback`, `linklocal`, `uniquelocal`) or a hop count. Behind a CDN in front of the host's web server, `true` treated the CDN edge address as the client, so all visitors behind one edge shared the API and login rate limits. With the proxies listed, rate limits see the real client address and requests that bypass the CDN cannot forge one. `true` keeps its previous meaning; an invalid list stops the server at startup.

## [0.14.1] - 2026-10-05

### Fixed
- Close JSDOM window instances after Readability extraction to prevent a Node.js heap memory leak in long-running daemon processes.
- Strip script, style, SVG, and iframe tags before JSDOM parsing, reducing memory footprint and DOM extraction latency from seconds to milliseconds.
- Optimize the full-text background queue candidate query to use index-backed relations, dropping query time from >2s to <80ms.
- Set a balanced scheduler interval and concurrency limit to ensure responsive API request handling on resource-constrained servers.

## [0.14.0] - 2026-10-05

### Added
- Shared article-content lifecycle for every reader: persistent preparation jobs, per-article extraction outcomes and retry times, content revisions, and item-content changes in native delta sync.
- Access-checked background preparation for selected articles through POST /api/v1/items/prepare. Ordinary article and bundle reads remain cache-only.
- Revision-checked MCP content pagination in HTML or plain text, so agents can retrieve all parts of long articles without silently losing the end.

### Changed
- Automatic full-text preparation prioritizes active editions, saved articles and notes, including protected articles after unsubscribing. The worker uses at most two concurrent requests and one per host, with durable jobs and access/capability checks before execution.
- Consent failures are remembered per article rather than disabling an entire feed. Paywalls, bot blocks, timeouts and short partial extractions have distinct outcomes; shorter extracts and later feed teasers preserve richer stored content.
- Native image proxy references cover all article images instead of only the first eight. Existing raster validation, image ownership checks and SSRF protection remain in force.
- Cached source helpers return complete available source text and content revisions; bounded consumers are responsible for explicit chunking or rejection, rather than unnoticed truncation.

### Fixed
- Metadata-only content updates do not update FTS5 a second time from nested triggers; reader revisions and full-text search remain consistent.

## [0.13.0] - 2026-10-05

### Added
- Universal Inbox (Read-it-Later): save web clippings, URLs, and personal notes directly to an isolated personal inbox feed (`POST /api/v1/inbox`) with automatic text/image archiving, sync support, and retention cleanup immunity. Includes `save_to_inbox` MCP tool for external agents and workflows.
- Linked edition overviews with up to five topics and validated article references, available to MCP publishers and native clients through `edition.overview`.
- Source and section names in edition candidates, plus an access-checked internal helper for bounded cached article text.

### Changed
- Native preferences distinguish explicit article limits from producer defaults. Setting `editionSize` to null restores the default; section-only changes preserve the choice.
- Emit current TypeScript declarations with core builds for downstream consumers.

### Fixed
- Prevent section preference initialization from implicitly overriding a downstream edition producer's default article count with 24.

## [0.12.0] - 2026-10-04

### Added
- Account capabilities negotiation: user endpoints (`GET /api/v1/me` and `GET /api/auth/me`) now expose an `AccountCapabilities` object (`type: "selfhosted"`, `features`, `manageUrl`), allowing clients to discover active capabilities dynamically.
- Pluggable `CapabilitiesProvider` and `requireCapability` middleware: allows downstream or hosted distributions to customize capability discovery and access control cleanly without patching core logic.
- Independent account capability for server full-text search (`search.fts`), separate from fetching reader text (`fulltext`). Native metadata advertises account capability discovery (`account-capabilities`).
- Claude Desktop and Cowork configuration snippet in web settings: allows one-click copying of the complete MCP server configuration block including personal access tokens.
- Capability checks on the Streamable HTTP `/mcp` route ensuring active MCP support.

### Changed
- Account capability discovery and enforcement use the same feature map. Explicit denials apply to every account type, and omitted flags do not grant access.
- Native sync, reading-state writes, note updates, app preferences, folder icon edits, full-text fetches and edition generation enforce the advertised account capabilities. MCP tools and automatic edition scheduling respect the same permissions.
- Existing notes and editions remain readable after a capability is disabled. Notes can still be exported or deleted; disabled features never delete stored content.
- Mixed mutation batches report capability denials per action, without consuming their mutation IDs, so queued changes can be retried after access is restored.

## [0.11.0] - 2026-10-04

### Added
- Automatic editions for native apps: the server puts together up to 24 unread stories using freshness, preferred sections, source diversity and duplicate detection. A shared time zone defines morning, midday, evening and late issues; a reading-time budget can keep an issue short.
- App-only reading preferences: `GET/PATCH /api/v1/native-preferences` synchronizes section order, newspaper visibility, preferred sections, time zone and edition size. Stable folder IDs survive renames, deleted folders are removed from the preferences, and the web reader keeps its existing category order and filters.
- Edition state, candidates and generation endpoints: `/api/v1/edition/state`, `/edition/candidates` and `/edition/generate`. Issue identities and revisions are retained across expiry and dismissal, and active issue articles are protected from retention cleanup and unsubscribing until the issue ends.
- MCP tools `get_edition`, `get_edition_candidates`, `generate_edition`, `dismiss_edition`, `get_native_preferences` and `update_native_preferences`. Agents can inspect the current issue and shared preferences, curate a selection, and publish it with revision checks and safe retries.

### Changed
- Curated editions take priority over automatic issues until expiry, defaulting to 24 hours and capped at seven days. `publish_edition` accepts an optional title, introduction, expected revision and request ID. Reading an article or refreshing feeds keeps the current issue in place.
- Native preference writes and edition commands use UUID request IDs with receipts retained for at least 35 days. Conflicts return the current state; changing the payload of an already used request ID is rejected.
- Feed icons prefer SVG artwork and the largest declared raster or touch icons, including icons from web app manifests. Unavailable candidates fall back to the next declared image, then the previous source and `/favicon.ico`.
- SVG icons are stored as 512-pixel PNGs for larger native displays. Existing feeds recheck their icons on the next poll, retaining the previous image until a replacement is available.

### Fixed
- New issues receive their own identity and creation time. Expiry and dismissal are delivered through native sync, and recreating an issue no longer resets its revision.

## [0.10.1] - 2026-10-03

### Changed
- Feed icons from SVG and ICO sources are stored as PNG, so native and web clients can use the same cached image. Existing icons are converted when first requested.
- The native API design and OpenAPI specification now describe the implemented routes and the note conflict contract.

### Fixed
- Deleting a note with `expectedRevision` now detects edits from another device. Revisions continue across deletion and recreation, and a deleted note's revision is available through `/sync` and `GET /items/{id}/note`.
- Feed icons are checked again about once a week, even when the feed returns 304. A changed icon updates its hash and sync entry; an unchanged icon does not create a new sync entry.

## [0.10.0] - 2026-10-03

### Added
- Full-text search with SQLite FTS5: `GET /api/v1/search` searches titles, snippets, cached full text, and personal article notes with BM25 relevance ranking, diacritic-insensitive matching, and phrase support. The index stays in step through database triggers on article changes.
- Article notes: attach personal Markdown notes to any article with `GET /api/v1/items/{id}/note` and `PUT /api/v1/items/{id}/note`, with conflict detection using expected revisions and offline mutation support (`item.note.set`, `item.note.delete`). Export individual notes as Markdown files or download all your notes in a single file from `GET /api/v1/notes/export`. Articles with notes are permanently excluded from database retention cleanups.
- Curated daily edition: `GET /api/v1/edition` serves an ordered list of up to 24 hand-picked articles with an expiry date, and MCP clients can assemble it with the new `publish_edition` tool.
- Feed icons served by the server: `/api/v1/subscriptions/{id}/icon` delivers icons directly with SHA-256 hashes and conditional ETags, and notifies clients of icon changes through `/sync`. The web app uses the server-served icons directly.
- SF Symbols for folders: `POST /folders` and `PATCH /folders/{id}` accept an optional `iconSymbol` (such as `newspaper.fill`), which syncs across devices for native apps that display folders as sections or ressorts.
- Retention rules in the meta endpoint: `GET /api/v1/meta` publishes `limits.retention` with the exact cleanup rules (whether cleanup runs, age limits for read and unread articles, and per-feed item caps) so offline clients can mirror the server's housekeeping.

## [0.9.0] - 2026-10-02

### Added
- Groundwork for native apps: `GET /api/v1/meta` and pairing a device with a one-time code (Settings → Devices, with a QR code). Each device gets its own revocable token for the new `/api/v1`, which MCP does not accept. See `docs/design/native-api.md`.
- Native API: `GET /api/v1/sync` delivers everything that changed in a user's state (article read and saved state and reading position, subscriptions, folders, muted keywords) from a compacted change log, and `POST /api/v1/mutations` applies changes made offline idempotently with last-writer-wins per field.
- Native API: subscriptions, folders, muted keywords, articles (cursor paging, search, content, bundles for offline copies), full text, images through the server, OPML and an overview, all under `/api/v1` and described in `docs/openapi.yaml`.
- MCP: `get_digest` returns unread articles grouped by feed with short snippets, and `get_overview` summarizes the account (unread and saved counts, top feeds, folders, failing feeds).
- MCP: `get_item` accepts `maxChars`, and `get_new_items` can leave out article HTML and shorten summaries, to save tokens.
- MCP: `update_feed` can switch push notifications and the app icon count per feed.
- MCP prompts (`daily_briefing`, `catch_up_on_topic`, `saved_reading_list`, `triage_unread`) and resources (feeds, OPML, saved articles, digest, single articles).

## [0.8.0] - 2026-10-02

### Added
- A service worker: the installed app starts without a connection and shows the articles, feeds and images you loaded last, with an offline notice. Cached account data is removed on logout.
- An offline copy keeps your saved articles (up to 300) and the newest 100 unread ones on the device with their full text and images, so they can be read, searched and filtered without a connection. Images of articles that are not archived are fetched through the server, which only serves images an article itself shows. A setting turns the offline copy off.
- Marking read and saving work offline: the changes are kept and sent when the connection is back.
- Web Push notifications for new articles, switched on per feed (Feeds → Edit) and per device (Settings), with a test button. Articles that match your muted keywords are not announced, and a feed's first fetch stays silent. A tap opens the article directly when there is one new article, otherwise the feed.
- The number of unread articles on the app icon, switched on per feed (off by default), and home screen shortcuts for saved articles and adding a feed.
- Sharing a web address from another app (Android and desktop Chromium) opens the add-feed dialog with it filled in.
- Feed icons are delivered through the server, so they also show offline and no third-party site is contacted when you browse.
- A database migration adds the notification and icon count settings and the registered devices; the server's push keys are created on first start.
- Prebuilt multi-architecture Docker images (`amd64` and `arm64`) published to the GitHub Container Registry, so FeedKeeper runs without cloning or building.
- Contribution guides for translations, a code of conduct, and a check that all languages contain the same text keys.

### Changed
- Built files are served with long-lived cache headers.
- `compose.yaml` pulls the published image. Building from source moved to `compose.build.yaml`.

### Fixed
- The article reader shows the source once, in its header.

### Security
- Push delivery checks every connection it makes, so a registered notification address cannot lead into the server's own network.

## [0.7.0] - 2026-10-01

### Added
- Saved articles are a lasting archive: saving keeps the full text and stores the images next to the database (`ARCHIVE_PATH`).
- Saved articles survive cleanups and unsubscribing, ignore the word filter, and their full text is searchable.
- Backups and restores include the archive folder.

### Changed
- Saving an article is called "Save for later" everywhere, including the MCP tool descriptions.
- The saved view lists articles in the order they were saved and shows read and unread ones.
- The README shows screenshots on iPhone and iPad.

## [0.6.1] - 2026-10-01

### Fixed
- Pull to refresh works again on phones, including when the pull starts on a newspaper card.

### Added
- A refresh button in the article list on tablets and desktops, with feedback about checked feeds and new articles.

## [0.6.0] - 2026-10-01

### Added
- A redesigned feeds page with search, filters by category or errors, and actions in a menu.
- Settings organized into sections with a sidebar on desktop, and a connection guide for MCP clients.
- Per-feed full-text switch, and memory for sites that answer with a cookie or subscription wall.
- MCP: `fetch_full_text`, `update_feed`, `rename_folder`, `delete_folder`, batch changes for up to 200 items, and `since`/`until` filters.
- A splash screen while the app starts.

### Changed
- Feed discovery checks every candidate before subscribing and finds feeds listed on a site's feed overview page.
- Phones always use the newspaper layout; the reader header is translucent.

### Fixed
- HTML entities in titles and feed names, missing site icons, and flickering images while scrolling.

## [0.5.0] - 2026-09-30

### Added
- A newspaper view next to the list view, and a redesigned header with an account menu.
- Display name and profile photo per account.
- Pull to refresh, an install option for the home screen, and new app icons.
- `npm run db:backup` and `npm run db:restore` for verified online backups.
- Read-only personal access tokens, and MCP tools `list_items`, `get_item`, `mark_unread` and `mark_all_read` with cursor paging.

### Changed
- Full-text fetching no longer identifies as Googlebot.

## [0.4.1] - 2026-09-29

### Security
- The IP of every feed and article connection is validated, including redirects, so DNS changes cannot bypass the private-network guard.
- Article HTML is sanitized with DOMPurify and the script policy is tighter.

### Changed
- Docker Compose requires an instance-specific `SESSION_SECRET`; more settings are configurable for Docker installs.
- `ALLOW_PRIVATE_FEEDS=true` allows feeds on private networks for trusted instances.

### Fixed
- Articles beyond the first 50 load, and literal search, muted keywords and feed ordering behave correctly.

## [0.4.0] - 2026-09-29

### Added
- Feed folders with custom ordering and unread counts, kept in OPML import and export.
- An in-app article reader with full-text fetching on demand and keyboard navigation.
- Mobile tab navigation and a home-screen manifest.
- MCP tools `list_folders`, `create_folder` and `move_feed_to_folder`.

### Changed
- Node.js 22.22.2+, 24.15+ or 26+ is required.

## [0.3.0] - 2026-09-28

### Added
- Feed auto-discovery from website addresses, with a picker when a site offers several feeds.
- Retention settings and automated daily housekeeping with SQLite `VACUUM`.
- Bookmarks, protected from cleanup, with a saved filter.
- Muted keywords per user.
- MCP tools `discover_feeds`, `bookmark_item`, `unbookmark_item`, the muted keyword tools and `cleanup_database`.

## [0.2.0] - 2026-09-27

### Added
- OPML 2.0 import and export.
- Feed health badges, error details and manual refresh.
- Docker and Docker Compose support with a health endpoint.
- MCP tools `export_opml`, `import_opml` and `refresh_feed`.

## [0.1.0] - 2026-09-17

First public release: an RSS and Atom reader with a remote MCP server, multi-user accounts, a trilingual interface (English, German, Japanese), SSRF-guarded feed fetching and a single-file SQLite database.

[Unreleased]: https://github.com/visualfusion/feedkeeper/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/visualfusion/feedkeeper/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/visualfusion/feedkeeper/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/visualfusion/feedkeeper/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/visualfusion/feedkeeper/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/visualfusion/feedkeeper/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/visualfusion/feedkeeper/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/visualfusion/feedkeeper/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/visualfusion/feedkeeper/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/visualfusion/feedkeeper/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/visualfusion/feedkeeper/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/visualfusion/feedkeeper/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/visualfusion/feedkeeper/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/visualfusion/feedkeeper/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/visualfusion/feedkeeper/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/visualfusion/feedkeeper/releases/tag/v0.1.0
