# Deployment Guide

## Contents

- [Flow](#flow)
- [Required secrets](#required-secrets)
- [Secret handoff](#secret-handoff)
- [Repository settings](#repository-settings)

## Flow

Production deployment starts only after an approved pull request is merged
into `main`. The deployment workflow revalidates the merged revision, confirms
the target API executable, preserves the live Apps Script time zone, pushes
project HEAD, creates a numbered version, and updates the stable API
executable.

## Required secrets

Create the GitHub environment `production`, restricted to `main`, and add:

| Secret | Purpose |
| --- | --- |
| `CLASP_AUTH_JSON` | Owner-only clasp authorization JSON, authorized for the Apps Script Deployments API. |
| `CLASP_PROJECT_JSON` | Private `.clasp.json` for the target script. |
| `APPS_SCRIPT_DEPLOYMENT_ID` | Stable owner-only API executable deployment ID. |

The stable deployment ID and its owner-only API-executable entry point are
verified before source upload. The workflow uses the Apps Script Deployments API
to update only the immutable version and description, retaining the entry-point
access configuration. Script Properties, Drive sources, spreadsheet data,
triggers, and Gemini credentials are not changed by deployment.

`CLASP_AUTH_JSON` must carry the
`https://www.googleapis.com/auth/script.deployments` OAuth scope. Re-authorize
clasp with the owner account before adding or replacing that secret if the
workflow reports an insufficient-permission error.

## Secret handoff

Before adding the environment secrets, copy each value into Bitwarden without
printing it to a terminal:

```sh
pbcopy < .installer/clasp-owner-auth.json
pbcopy < .clasp.json
jq -r '.deploymentId' .installer/state.json | pbcopy
```

Save the values as `CLASP_AUTH_JSON`, `CLASP_PROJECT_JSON`, and
`APPS_SCRIPT_DEPLOYMENT_ID`, respectively. Once they are saved, set the GitHub
environment secrets from the local files; do not commit any of them.

## Repository settings

Protect `main`: require pull requests, one approval, fresh approval after new
commits, resolved conversations, and the `Validation / check` status check.
Disable direct pushes. The `production` environment may additionally require
an approval before it releases its secrets.
