# Configuration Reference

## Contents

- [Local configuration](#local-configuration)
- [Script Properties](#script-properties)
- [Drive policy](#drive-policy)
- [Taxonomy](#taxonomy)
- [Related documentation](#related-documentation)

## Local configuration

Copy `config.example.json` to the private `config.local.json` through the
installer. The source of truth is saved in `AUTOMATION_CONFIG_JSON` during the
bootstrap.

| Key | Purpose |
| --- | --- |
| `locale` | `en` by default, or `it` for this installation. |
| `time_zone` | IANA timezone used by Apps Script and the spreadsheet; defaults to `Europe/Rome`. |
| `gemini_model` | Gemini model ID; defaults to `gemini-3.6-flash`. |
| `intake_keyword` | Required marker in every eligible `transactions-*.json` filename; folder names do not qualify a source. |
| `excluded_root_folder_names` | Direct-root folders that the scanner ignores. |
| `archive_folder_name` | Archive root: `Imported` for English or `Importazioni` for Italian; legacy `_Imported` is always ignored. |
| `test_fixture_folder_name` | Isolated test root, normally `_Test-fixtures`. |
| `categories` | Allowed category and one-level subcategory taxonomy. |

For a new installation, `make install` provisions the required Google resources.
After the browser handoff, run the same command again: it resumes safely. On a
completed installation, the same command reconciles the checkout, Drive policy,
Apps Script configuration, timezone, model, and triggers while preserving the
existing Gemini credential and automatic-processing state. `make update` is an
alias.

Set `time_zone` and `gemini_model` in `config.local.json`, or override either
one for a single run with `GDEC_TIME_ZONE` and `GDEC_GEMINI_MODEL`.

For an existing configuration that predates `gemini_model`, ordinary updates
preserve the legacy model. Apply all current installer defaults deliberately
with `make apply-defaults`; it preserves the credential and automatic
processing state.

## Script Properties

| Property | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Private Gemini Developer API credential. |
| `GEMINI_BACKEND` | `gemini_api` or `vertex_ai`. |
| `GEMINI_MODEL` | Model ID; new installations default to `gemini-3.6-flash`. |
| `GEMINI_AUTO_VERTEX_FALLBACK` | Enables temporary Vertex fallback after quota exhaustion; disabled unless explicitly selected. |
| `GOOGLE_CLOUD_PROJECT_ID` | Cataloger Cloud project; it requires billing only for Vertex AI. |
| `ROOT_FOLDER_ID` | `Spese` folder ID. |
| `SPREADSHEET_ID` | Canonical ledger spreadsheet. |
| `AUTOMATION_CONFIG_JSON` | Complete validated local configuration. |

## Drive policy

The installation-specific `AGENTS.md` in Drive controls the trusted processing
policy. It cannot widen the code-enforced root-folder scope. Never place API
keys or passwords in it.

It does not define tabs, columns, formulas, or charts. Those are Apps Script
schema concerns documented in [Spreadsheet lifecycle and schema](SPREADSHEET.md).

## Taxonomy

Each expense has one category and one subcategory. `Health` is human-only;
veterinary bills and dog medicines belong to `Dogs`. Merchant/supplier remains
a separate normalized field so a Lidl/Conad comparison does not consume the
subcategory dimension. The dashboard supports at most 25 category series;
known default categories use localized chart labels and custom categories retain
their configured names. Tags are intentionally absent in the first release.

## Related documentation

- [Project overview and documentation index](../README.md)
- [Installation guide](INSTALLATION.md)
- [Spreadsheet lifecycle and schema](SPREADSHEET.md)
- [Operations guide](OPERATIONS.md)
- [Deployment guide](DEPLOYMENT.md)
