# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.2] - 2026-07-20

### Added

- A localized, formula-driven dashboard with year-selection controls, dynamic
  category, payer, merchant, and monthly-spending visualizations.
- A protected `Calculation data` worksheet for dashboard calculation ranges,
  keeping generated formulas out of the user-facing dashboard.
- Automatic initial-balance configuration and explanatory opening-balance audit
  details, with manual overrides retained separately from generated values.
- Merchant enrichment for incomplete imports, including deterministic fallback
  merchants inferred from the transaction description and category.
- Spreadsheet lifecycle and customization documentation, including the
  installer-owned default schema and non-destructive update behavior.
- A targeted `categorizeIncomeRefunds` maintenance entrypoint that classifies
  legacy income rows missing a reporting category, without rewriting their
  amount, allocation, or source provenance.

### Changed

- Make `Transazioni` the sole canonical ledger and derive all summaries,
  balances, dashboard tables, and charts dynamically from it.
- Refresh the dashboard visual design, chart legends, localized Italian labels,
  and category names while retaining English as the installation default.
- Preserve user-adjusted dashboard chart positions and ordinary dimensions
  during a refresh; the Top 20 chart height intentionally follows the monthly
  category chart, and new installations use the approved default layout.
- Show all months and their spending totals in the monthly-category chart, and
  retain the adaptive annual-label format for one or multiple selected years.
- Organize generated spreadsheet controls and calculation data into managed,
  protected sheets rather than hidden remote columns in user-facing tabs.
- Treat Tricount `INCOME` rows as categorized, signed refunds in spending
  reports: they reduce the relevant category, month, year, payer, merchant,
  and KPI total instead of inflating spending or appearing uncategorized.
- Keep participant cash settlements visible for balance reconciliation while
  excluding them from all household-spending totals and charts.
- Support up to 25 configurable dashboard category series; default categories
  use localized labels and custom categories retain their configured names.

### Fixed

- Persist normal-intake and historical-rebuild JSON stages with the supported
  `application/json` MIME string, restoring resumable imports in Apps Script.
- Reject incomplete Gemini candidates instead of accepting truncated JSON, and
  expose the runtime version and effective fallback backend through setup status.
- Activate automatic Vertex fallback only for verified daily-quota or depleted
  prepayment-credit responses; retry transient rate limits and network failures.
- Keep OAuth credentials out of deployment command arguments, require an exact
  owner-only stable executable, close the pre-promotion stale-revision race, and
  validate the provider envelope before accepting trigger repair.
- Rebuild balance movements from opening balances and participant allocations,
  preventing systematic monthly carry-forward mismatches; tolerate only
  cent-level checkpoint residuals through explicit balancing adjustments.
- Backfill missing allocation details, normalize historic transaction types,
  and exclude transfers and opening-balance controls from spending aggregates.
- Classify historic income refunds before rebuilding dashboard formulas, so
  existing negative rows immediately reduce their appropriate reporting
  categories without a destructive JSON re-import.
- Prevent dashboard charts from being created before their dynamic sources are
  calculated, and avoid changing their geometry on later refreshes except for
  the intentional Top 20 height synchronization.

## [0.2.1] - 2026-07-18

### Fixed

- Reconcile the managed Apps Script time triggers immediately after promoting a
  new stable API-executable version, preventing scheduled imports from staying
  bound to an older release.
- Create replacement triggers before removing existing ones, so a failed
  replacement leaves the prior automation available.
- Report the automatic-processing flag, missing handlers, duplicate handlers,
  and per-handler trigger counts through the read-only setup and installation
  status functions.
- Serialize trigger installation and removal, and refuse to enable automatic
  processing unless exactly one managed trigger exists for each handler.
- Rebind triggers through the promoted non-development executable even if
  `main` advances immediately after deployment promotion.
- Wait for an in-flight import's shared lock before trigger reconciliation, so
  deployment does not leave the prior trigger version in place during normal
  processing.
- Invoke trigger reconciliation through the configured API-executable
  deployment ID, rather than relying on an unspecified executable deployment.

## [0.2.0] - 2026-07-18

### Added

- Recursive JSON intake: matching exports can be placed directly in the Drive
  root or in nested folders under a non-excluded root child folder.
- Source-unit archival: root JSON files archive individually, while an
  imported JSON in a folder archives only its closest containing folder.
- Deepest-first processing and archival for nested source units, preventing a
  parent folder from moving an unprocessed descendant export.
- Regression coverage for root-file, nested-folder, and resumable rebuild
  archival behavior.
- Controlled-import CLI documentation using the installation-specific owner
  authorization required by Apps Script execution.
- A manual full-intake entrypoint for controlled root-file and nested-source
  tests without enabling scheduled processing.
- Resumable normal-intake staging that reuses completed Gemini classification
  batches after a timeout or later processing failure.

### Changed

- Archive folders now use `Imported` by default and `Importazioni` for Italian
  installations; legacy `_Imported` remains protected from intake.
- Source eligibility now requires the configured household keyword in each
  transaction JSON filename; folder names alone no longer make exports
  eligible.
- Historical rebuild state is versioned with required archive metadata, so an
  incompatible in-progress legacy rebuild is rejected before it can write or
  archive data.
- The installed Drive `AGENTS.md` policy template now documents the JSON intake
  and source-unit archival contract.

### Fixed

- Revalidate the discovered JSON inventory and content hashes before rebuild
  commit and source archival, preventing changed or newly added JSON files from
  being moved without durable import decisions.
- Validate normal-intake snapshots before the first Gemini call and before
  ledger or archive mutation, then remove transient processing state after a
  successful archive.
- Authenticate Drive staging batches with independently bounded digest
  properties, rejecting modified or duplicate stage files, and cleaning them
  while the verified source remains discoverable for retry.
- Revalidate every staged rebuild source immediately before replacing the
  canonical ledger, preventing a late Drive change from triggering a stale,
  destructive rebuild.
- Authenticate historical rebuild staging payloads with durable digests and
  retain a committed archival checkpoint so cleanup or archive retries cannot
  discard the rebuilt ledger.
- Replace managed policy template instructions in an existing Drive `AGENTS.md`
  while preserving Drive-only policy blocks and migrating known pre-marker
  template content.
- Restrict root-file attachment evidence lookup to direct-root siblings instead
  of recursively searching unrelated intake, fixture, receipt, and archive
  folders.
- Align installation, deployment, recovery, configuration, and release backlog
  documentation with the implemented authorization and intake contracts.

## [0.1.1] - 2026-07-18

### Added

- Configurable IANA timezone for Apps Script and spreadsheet installation.

## [0.1.0] - 2026-07-18

### Added

- Complete Tricount JSON ingestion with exact participant allocations, source
  transaction identifiers, custom categories, and attachments as fallback
  classification evidence.
- Canonical transaction ledger, source reconciliation, opening-balance checks,
  participant balance views, and reporting dashboard.
- Gemini Developer API processing with automatic Vertex AI fallback and
  localized English and Italian spreadsheet support.
- Durable, resumable historical JSON rebuild staging that leaves the canonical
  ledger unchanged until its final commit.
- Installer, configuration, operational documentation, project policy,
  validation tests, and MIT license.
- Pull-request-gated GitHub Actions validation and production Apps Script
  deployment, including owner-only API executable preservation checks.
