# Changelog

All notable changes to FeedKeeper are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/) for its releases. The full release notes, including upgrade notes, are on the [releases page](https://github.com/visualfusion/feedkeeper/releases).

## [Unreleased]

### Added
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

[Unreleased]: https://github.com/visualfusion/feedkeeper/compare/v0.8.0...HEAD
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
