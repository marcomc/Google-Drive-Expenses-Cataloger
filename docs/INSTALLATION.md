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
creates an `AGENTS.md` policy in the root only if one does not already exist.

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

Do not leave historical candidate folders in the root for the first run. Move
them to `_Test-fixtures`; that folder is ignored by the runtime. Return one
original folder to `Spese`, wait for the 15-minute trigger or run
`processExpenseFolder(folderId)` manually, and validate the result before the
next case. When the fixtures are isolated, run `enableExpenseCataloging()` once
to enable scheduled intake.
