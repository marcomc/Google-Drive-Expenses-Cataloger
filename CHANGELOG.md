# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
