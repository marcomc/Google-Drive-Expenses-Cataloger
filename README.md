# Google Drive Expenses Cataloger

Google Apps Script automation that imports complete Tricount JSON exports from
a Google Drive intake folder into one canonical Google Sheets ledger. It
preserves exact participant allocations and custom categories, then uses Gemini
only to classify spending in the configured reporting taxonomy.

## Contents

- [Architecture](#architecture)
- [Data model](#data-model)
- [Setup](#setup)
- [Testing](#testing)
- [Documentation](#documentation)
- [Deployment](#deployment)
- [License](#license)

## Architecture

```mermaid
flowchart LR
  folder["Drive: Spese"] --> event["15-minute polling / daily fallback"]
  event --> policy["AGENTS.md + config"]
  policy --> json["Eligible HoStello JSON exports"]
  json --> ai["Gemini classification"]
  ai --> dedupe["Deduplication"]
  dedupe --> ledger["Sheets: Transazioni"]
  ledger --> dashboard["Dashboard and comparisons"]
  dedupe --> audit["Importazioni audit"]
  audit --> archive["Imported or Importazioni / YYYY"]
```

## Data model

`Transazioni` is the single canonical ledger. Each row contains source links,
date-derived year and month, payer, beneficiaries, amount and currency,
transaction type, source type/status, source and custom categories, exact
participant allocations, exchange rate, provenance, AI confidence, and an
immutable duplicate fingerprint. Transfers are excluded from spending totals.
Tricount `Bilancio` entries are opening-balance controls rather than ledger
rows. `Source reconciliations` proves that every JSON entry and amount has an
explicit durable outcome (imported, duplicate, or opening-balance marker).

## Setup

```sh
make install-check
make install
```

The installer follows the same resumable Google Cloud, Apps Script, Gemini key,
Vertex fallback, and validation workflow as the sibling cataloger. It creates
the Google resources and prints a one-time browser handoff when required.

## Testing

Before the first live import, move candidate source files and folders to
`_Test-fixtures`. Return one or a few untouched source units to the root for
each controlled test.
Tests cover a new import, an exact re-import, a partially overlapping JSON
source, exact custom allocations, and opening-balance classification.
No source folder is deleted.

## Documentation

See [installation](docs/INSTALLATION.md), [configuration](docs/CONFIGURATION.md),
and [operations](docs/OPERATIONS.md). The planned work is in [TODO.md](TODO.md)
and the delivered changes are in [CHANGELOG.md](CHANGELOG.md).

## Deployment

Production source deployment happens only after an approved pull request is
merged into `main`; see the [deployment guide](docs/DEPLOYMENT.md).

## License

Licensed under the [MIT License](LICENSE).
