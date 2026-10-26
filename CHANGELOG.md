# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Show each person's age on their card: current age for the living, age at
  death for the deceased, in years and months (for example `82y 2m`). Ages from
  uncertain or partial dates are marked `~`; no age is shown when it cannot be
  worked out.
- Remove a parent, spouse or child link from the side panel with the `✕` next
  to the relationship, after a confirmation. Both people stay in the tree, and
  the link is removed on both sides.
- Print the current view, or save it as a PDF, with the printer button in the
  header (or `Ctrl`/`Cmd`+`P`). The printout follows the selected view (*Whole
  Family*, *Close Family* or *Ancestors*) and focus person, one section per
  generation in the order the cards are drawn, with each person's facts,
  relatives cross-referenced by number, and notes. A *compact* option prints one
  table line per person instead, and the Ancestors view uses Ahnentafel numbers
  (father 2n, mother 2n+1). Notes can be left out and the details of living
  people withheld.

### Changed
- Close Family now also shows the focused person's spouse(s) and children (one
  generation down), not only their ancestors and the ancestors' siblings.

### Fixed
- Link a new sibling to a person who has no recorded parents. Siblings without
  a shared parent are now stored as explicit, reciprocal `sibling_ids` links and
  drawn in the same row with their own sibling bar, instead of being added
  unlinked.
- Linking an existing person as a sibling only fills their missing parent roles
  and no longer replaces parents they already have.
- Place each direct-line parent at the inner edge of their sibling row (fathers
  at the right end, mothers at the left) so couples stay side by side and their
  child sits under them, instead of a marriage line spanning a whole row of
  birth-ordered siblings.
- Draw each person once even when they are reachable twice, such as a spouse
  who is also a sibling or a cousin, instead of duplicating their card.

## [1.2.3] - 2026-08-23

### Added
- Add real-browser smoke coverage for the hosted IndexedDB experience and the
  local server's create, edit, reload, export and import lifecycle.
- Make family-tree cards keyboard operable and expose labels, selected states,
  live save feedback and reduced-motion behavior to assistive technology.

### Fixed
- Bound adversarial tree-layout work, terminate ancestry cycles safely and
  connect children to the correct parental union in multi-spouse families.
- Preserve valid and dangling relationship ids independently instead of losing
  valid links when one imported reference cannot be resolved.
- Centralize parent and spouse mutations so reciprocal links stay consistent,
  replaced parents lose stale child links and cycle-creating edits are rejected.
- Serialize autosaves by edit generation so an older completion cannot mark a
  newer edit as saved, and stop tree or storage transitions after a failed save.

## [1.2.2] - 2026-08-23

### Security
- Validate the local API's complete browser origin, including scheme and port,
  require a per-process request token for mutations, and require JSON media
  types for endpoints that accept JSON bodies.
- Create local data, configuration, temporary and recovery files with private
  permissions, and use unique no-clobber filenames for concurrent writes,
  backups, trash entries and folder moves.
- Validate imported tree documents and bound their size, depth, person count
  and relationship arrays before storing or rendering them.
- Pin every GitHub Action to an immutable commit and pin the npm publishing
  client, with Dependabot updates for the pinned actions.

### Fixed
- Maximum-length tree names no longer hang when their generated id collides.
- Simultaneous saves no longer race on the same temporary file.
- Multiple backups or deletions in the same second retain distinct recovery
  copies, and browser-folder saves stop if a required backup cannot be made.
- Moving a maximum-length tree id into a folder containing the same id now
  chooses a valid destination id that remains visible in the library.

## [1.2.1] - 2026-08-22

### Security
- Restrict the CLI's `--host` option to loopback addresses and reject missing
  option values, preserving the local-only server boundary even with malformed
  or unsafe command-line arguments.

### Added
- Private vulnerability-reporting guidance, a privacy-aware bug-report form and
  a pull-request checklist.
- An explicit README scope note for unsupported genealogy interchange and
  archival features.

## [1.2.0] - 2026-08-16

### Added
- **Choose the default person for each tree.** The person panel now has a
  translated **Set as default** action that saves the choice in `summary.root`,
  immediately recenters the canvas and restores that person after reload. Older
  tree files still fall back safely to their legacy root marker or first person.
- **Pull-request test coverage.** GitHub Actions now runs the full test suite on
  Node.js 18, 20 and 22 for every pull request.

## [1.1.0] - 2026-08-15

### Added
- **Quick-add buttons on the canvas.** Selecting a person now shows small `+`
  buttons right on their card: one above for each still-missing parent (colored
  like the father/mother avatars), one on the right edge for a spouse (sitting
  on the marriage-connector line; always available, since multiple marriages
  are common in family history) and one below to add a child. They open the
  same add-relative dialog as the panel chips, work with mouse and touch, and
  a parent recorded by name but not yet linked (a "ghost") is not offered twice.
  When adding a spouse, the dialog now defaults the new person's sex to the
  opposite of the selected person's (still changeable, also from the panel chip).

### Security
- **Escaped person ids in every HTML template.** A crafted tree file could use a
  person `id` containing markup to inject HTML into the search results, link
  suggestions, relation chips and parent selector. The CSP already blocked script
  execution, but imported files can no longer inject any markup at all.
- **Anti-clickjacking for the hosted build.** Browsers ignore `frame-ancestors` in
  a `<meta>` CSP and GitHub Pages cannot send headers, so the app now refuses to
  run inside a frame (the local server still sends the real CSP header).

### Fixed
- **Trees with numeric ids now fully work.** Ids and relationship references from
  imported files are coerced to strings on load; previously clicking a search
  result or relation chip in such a tree silently did nothing.
- **Backup rotation could trim a sibling tree's backups.** Rotating backups for a
  tree named `family` also matched files belonging to `family-2` (both in the Node
  store and the browser folder store); the match is now exact.
- **Corrupted `localStorage` no longer breaks startup.** An unknown saved language
  or view mode is ignored instead of crashing the app before it loads.
- **Pending edits are flushed when the tab is hidden or closed** (best-effort, on
  top of the existing unsaved-changes prompt), so quick close/switch-away no longer
  risks losing the last second of typing.
- **Honest delete warnings in browser storage.** When trees live in IndexedDB there
  is no trash folder or backups, and the delete confirmations now say so instead of
  promising recoverability that doesn't exist.

### Added
- **Mobile-friendly touch & layout.** The canvas now supports two-finger
  **pinch-to-zoom** (and two-finger pan) on phones and tablets, in addition to the
  existing one-finger pan, so the tree is fully navigable by touch without reaching for
  the on-screen zoom buttons. On narrow screens the header compacts (the segmented view
  control moves to its own full-width row, secondary stats hide) and the person editor
  panel expands to fill the screen instead of clipping off the right edge.
- **First-run welcome popup.** A small, well-designed dialog on the first visit explains
  what Genograph is, its privacy model, and how to use it (click a person, add relatives,
  build your own trees). On the hosted browser build it also points to the purely local
  `npx genograph` version with a copy-to-clipboard command; that tip is hidden in the
  local app. A `?` help button in the header reopens it any time. Fully translated (EN/TR)
  and theme-aware; shown once per browser (tracked in `localStorage`).
- **Run it in your browser — no install.** A free, static build hosted on GitHub Pages
  (<https://genograph.github.io/>) with the same UI as the local app. Your
  data still stays on your machine: real `.json` files in a folder you pick via the File
  System Access API (Chromium — with `.backups/` and `.trash/`, just like the local app),
  or your browser's own local database (IndexedDB) on other browsers and before a folder
  is chosen. The page makes no network requests after it loads; **Export JSON** is the
  backup/portability path for browser storage.
- **One storage interface, three auto-detected backends** (local server, picked folder,
  IndexedDB). The persistence layer was factored out of the UI into shared modules under
  `public/lib/` (`treeStore`, `storage`, `serverStore`, `fsStore`, `idbStore`) reused by
  the Node store, so id/slug rules and the tree shape stay identical everywhere.
- `.github/workflows/pages.yml` builds and deploys the static site (only `public/` plus the
  bundled example — never your `trees/`).
- **Custom data folder from the app.** The tree menu now surfaces where your trees
  are saved and lets you change it — point the app at an existing folder of trees,
  or move your current trees into a new one (e.g. your Desktop). The choice is
  remembered across launches in `~/.genograph/config.json`.
- `GET`/`PUT /api/settings` endpoint backing the data-folder picker.
- `GENOGRAPH_DATA` / `--data` now pin the folder for a single run and take
  priority over the remembered choice (the in-app picker is disabled while pinned).

## 1.0.0 - 2026-06-28

First public release.

### Added
- Offline family-tree browser & editor with a local-only HTTP server.
- **Multi-tree library:** create, open, rename, duplicate, delete, import and
  export (JSON) any number of family trees.
- Per-person editing: name, sex, dates (with *approximate* flags), places &
  countries, occupation, burial place, maiden name, aliases, cause of death,
  and free-text interview notes.
- Three views (Whole Family / Close Family / Ancestors), search, focus/re-root,
  pan & zoom, dark mode, and an English/Turkish interface toggle.
- Automatic backups before every save (kept per tree).
- Bundled example tree: the immediate relatives of Guy de Lusignan.
- `npx genograph`, global install and double-click launchers.

### Security
- Server binds to `127.0.0.1` only and rejects non-local `Host`/`Origin` requests
  (defends against DNS-rebinding / CSRF from other sites).
- Strict path handling for static files and tree storage.
- Strict Content-Security-Policy; no external resources or network calls.

[Unreleased]: https://github.com/genograph/genograph.github.io/compare/v1.2.3...HEAD
[1.2.3]: https://github.com/genograph/genograph.github.io/releases/tag/v1.2.3
[1.2.2]: https://github.com/genograph/genograph.github.io/releases/tag/v1.2.2
[1.2.1]: https://github.com/genograph/genograph.github.io/releases/tag/v1.2.1
[1.2.0]: https://github.com/genograph/genograph.github.io/releases/tag/v1.2.0
[1.1.0]: https://github.com/genograph/genograph.github.io/releases/tag/v1.1.0
