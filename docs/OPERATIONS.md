# Operations Guide

## Contents

- [Normal flow](#normal-flow)
- [Review email](#review-email)
- [Duplicate behavior](#duplicate-behavior)
- [Source reconciliation](#source-reconciliation)
- [Dashboard](#dashboard)
- [Full JSON rebuild](#full-json-rebuild)
- [Recovery](#recovery)

## Normal flow

The 15-minute trigger scans only direct child folders of `Spese`; the daily
trigger is the safety net. A candidate must contain the configured keyword in
its own name or in a direct JSON filename. `Ricevute`, `_Test-fixtures`, yearly
archives, and non-matching exports remain untouched.

After a verified import, the source folder moves to `_Imported/YYYY`. The year
uses the earliest transaction date in the import. Cross-year exports therefore
remain intact as one source folder while the ledger itself partitions values by
their actual dates.

## Review email

The runtime imports a best-supported classification when a confidence is below
the threshold or it conflicts with historical treatment. The email identifies
the date range, source folder and JSON links, entry coordinates and IDs, all transaction
facts, proposed classification, confidence, rationale, and related conflict.

## Duplicate behavior

The ledger stores a normalized fingerprint of date, amount, currency,
description, payer, and beneficiaries. An exact match already in the ledger is
skipped and written to the import audit. New rows in a partially overlapping
export are imported. The original source JSON and folder remain traceable from
every imported record.

## Source reconciliation

Every processed JSON document receives a durable reconciliation row. It records its
Drive file ID, content SHA-256, source-row count, totals per currency, and the
decision for each source row: `imported`, `duplicate`, or `opening_balance`.
The import can archive only when the source count and monetary totals are fully
accounted for. A duplicate remains part of the reconciliation even though no
second ledger row is created.

Per-person balance views use the exact allocation amounts retained by Tricount.
`Bilancio` entries are opening-balance controls, so they are not spending and
are not imported into the ledger. They validate the prior balance trajectory
without being counted twice.

## Dashboard

The dashboard provides annual, month-by-year, category, subcategory, dog-cost,
merchant, and payer comparisons. Spending charts exclude `transfer` and
`opening_balance`; those types remain available in the ledger and their own
summary.

## Full JSON rebuild

`rebuildTransactionsFromTricountJson` is the explicit one-off migration for
the existing historical exports. It scans eligible complete JSON documents
outside `_Test-fixtures` and `_Imported`, preserves their source folders, and
replaces the canonical ledger, audit, and source-reconciliation rows only after
all sources have been parsed and normalized. Run it only after the controlled
folder tests pass; this keeps fixture data out of the live ledger.

## Recovery

If a run fails before archiving, correct the configuration or source data and
run the controlled folder function again. If it fails after a ledger write,
consult `Importazioni` and the source links before retrying. Do not delete rows
or source folders blindly: the audit exists to make an intentional correction
safe.
