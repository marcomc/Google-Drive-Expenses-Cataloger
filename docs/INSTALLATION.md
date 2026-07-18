# Installation Guide

## Contents

- [Prerequisites](#prerequisites)
- [Prepare Drive](#prepare-drive)
- [Install](#install)
- [Browser handoff](#browser-handoff)
- [First controlled run](#first-controlled-run)

## Prerequisites

Install Bash, Git, Node.js 20 or newer, `jq`, Google Cloud CLI, and `clasp` is
run through its pinned `npx` version. Authenticate the same Google account in
Google Cloud and clasp; it must own the Apps Script project and edit the Drive
folder and spreadsheet.

The Gemini Developer API project is separate and has no billing account, so it
keeps its own Free Tier quotas. Vertex AI fallback is optional: enable it only
after explicitly supplying a billing account for the cataloger Cloud project.

## Prepare Drive

Use the `Spese` folder as the intake root and grant the owner Editor access to
its children and to the existing `HoStello - Spese` spreadsheet. The installer
creates an `AGENTS.md` policy in the root. For an existing policy, it merges
the current template instructions, preserves Drive-only instructions, then
writes and rereads the same file to verify the merged policy.

Create or select the cataloger Cloud project. Keep the Gemini key project
separate and billing-disabled. A billing account is unnecessary unless you opt
in to Vertex AI fallback.

## Install

```sh
make install-check
make install
```

On the first run the installer creates `config.local.json`. Set the recipient,
keep `locale` as `it` for this installation, and adjust the allowed categories
only before the initial import. `config.local.json` is private and ignored by
Git.

The installer asks for the cataloger project, billing account, Drive root, and
Gemini Free Tier key project. It never prints a generated Gemini key. It reports
its key-resource name and a `gcloud services api-keys get-key-string …` command
for copying the key to Bitwarden. A temporary Secret Manager version transfers
the key to the bootstrap; it is deleted after a verified installation and never
written to repository files or long-lived installer state.

## Browser handoff

Complete the clasp authorization with the owner account and enable the Apps
Script API when prompted. Then resume:

```sh
make install-resume
```

The bootstrap creates or adopts the spreadsheet resources, Script Properties,
the Drive policy, ignored fixture/archive folders, and time triggers. Automatic
processing is deliberately disabled at first, so the historical folders can be
isolated without a race. It then validates the ledger layout and trigger before
reporting the installed spreadsheet URL.

## First controlled run

Do not leave historical candidate files or folders in the root for the first
run. Move them to `_Test-fixtures`; that folder is ignored by the runtime.
Return one original folder to `Spese` and copy its folder ID from the Drive URL.

Use the installation-specific owner authorization for every `clasp run`. The
default public clasp OAuth client does not carry the sensitive project scopes
and Google may block its consent request. Inspect the configured properties:

```sh
npx --yes @google/clasp@3.3.0 \
  -A .installer/clasp-owner-auth.json \
  --json run getSetupStatus
```

Then validate the Drive policy, spreadsheet schema, and installed trigger:

```sh
npx --yes @google/clasp@3.3.0 \
  -A .installer/clasp-owner-auth.json \
  --json run validateCatalogerInstallation
```

Import the selected folder manually:

```sh
npx --yes @google/clasp@3.3.0 \
  -A .installer/clasp-owner-auth.json \
  --json run processExpenseFolder \
  --params '["DRIVE_FOLDER_ID"]'
```

After validating the ledger, import audit, reconciliation, and archived source
folder, repeat with the next fixture. `processExpenseFolder` accepts only a
direct child of `Spese` with an eligible direct JSON file.

To test a JSON placed directly in `Spese` or in a nested source folder, keep all
other candidates in `_Test-fixtures`, place only the intended test source in
intake, and run one complete manual scan without enabling scheduled processing:

```sh
npx --yes @google/clasp@3.3.0 \
  -A .installer/clasp-owner-auth.json \
  --json run processExpenseIntake
```

After the controlled cases pass and the remaining fixtures are isolated,
enable scheduled intake once:

```sh
npx --yes @google/clasp@3.3.0 \
  -A .installer/clasp-owner-auth.json \
  --json run enableExpenseCataloging
```

The 15-minute trigger will then process future eligible source units. Do not
run `clasp login` again for these commands; the dedicated authorization already
contains the required Apps Script, Drive, Sheets, and mail scopes.
