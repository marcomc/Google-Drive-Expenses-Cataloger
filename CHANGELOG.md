# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

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
