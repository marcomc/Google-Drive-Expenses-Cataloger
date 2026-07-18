# Configuration Reference

## Contents

- [Local configuration](#local-configuration)
- [Script Properties](#script-properties)
- [Drive policy](#drive-policy)
- [Taxonomy](#taxonomy)

## Local configuration

Copy `config.example.json` to the private `config.local.json` through the
installer. The source of truth is saved in `AUTOMATION_CONFIG_JSON` during the
bootstrap.

| Key | Purpose |
| --- | --- |
| `locale` | `en` by default, or `it` for this installation. |
| `intake_keyword` | Required marker in an eligible folder or JSON filename. |
| `excluded_root_folder_names` | Direct-root folders that the scanner ignores. |
| `archive_folder_name` | Archive root, normally `_Imported`. |
| `test_fixture_folder_name` | Isolated test root, normally `_Test-fixtures`. |
| `categories` | Allowed category and one-level subcategory taxonomy. |

## Script Properties

| Property | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Private Gemini Developer API credential. |
| `GEMINI_BACKEND` | `gemini_api` or `vertex_ai`. |
| `GEMINI_AUTO_VERTEX_FALLBACK` | Enables temporary Vertex fallback after quota exhaustion; disabled unless explicitly selected. |
| `GOOGLE_CLOUD_PROJECT_ID` | Cataloger Cloud project; it requires billing only for Vertex AI. |
| `ROOT_FOLDER_ID` | `Spese` folder ID. |
| `SPREADSHEET_ID` | Canonical ledger spreadsheet. |
| `AUTOMATION_CONFIG_JSON` | Complete validated local configuration. |

## Drive policy

The installation-specific `AGENTS.md` in Drive controls the trusted processing
policy. It cannot widen the code-enforced root-folder scope. Never place API
keys or passwords in it.

## Taxonomy

Each expense has one category and one subcategory. `Health` is human-only;
veterinary bills and dog medicines belong to `Dogs`. Merchant/supplier remains
a separate normalized field so a Lidl/Conad comparison does not consume the
subcategory dimension. Tags are intentionally absent in the first release.
