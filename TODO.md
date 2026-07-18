# TODO

This backlog records concrete work intentionally deferred from the first
release. Completed work belongs in [CHANGELOG.md](CHANGELOG.md).

## Propositions

- [ ] **Complete disposable Google integration tests**
  - Provision an isolated Drive root, spreadsheet, Apps Script project, and
    Cloud project.
  - Cover new, exact re-import, overlapping JSON, opening-balance checks,
    Vertex fallback, resumable rebuild, and cleanup.

- [ ] **Add rebuild progress reporting**
  - Send an optional completion or failure email for the staged historical
    rebuild, including run ID, source count, and next action.
  - Keep source descriptions and allocation details out of broad status mail.

- [ ] **Add a read-only installation reconcile command**
  - Compare deployed Apps Script source, API deployment, triggers, Script
    Properties, Drive policy, and spreadsheet schema without mutation.
  - Keep repair actions explicit and separately authorized.

- [ ] **Improve bootstrap workflow and documentation**
  - Define and document one canonical path for first installation,
    reconfiguration, credential setup, deployment, and initial import.
  - Make bootstrap steps idempotent where practical and provide actionable
    diagnostics for partial setup, authorization, and rerun failures.
  - Add verification checkpoints and concise flowcharts covering local setup,
    Google Cloud resources, Apps Script deployment, and production readiness.

- [ ] **Evaluate event-driven Drive intake**
  - Assess Google Workspace Events API for direct-child Drive changes using the
    configured billing-enabled cataloger Cloud project.
  - Prototype a secure Pub/Sub receiver and compare Cloud Run versus an Apps
    Script-compatible endpoint for event delivery.
  - Retain durable, idempotent intake state and the daily polling fallback so
    missed or duplicate events cannot cause missed or repeated imports.
  - Compare the operating complexity and free-tier cost with the current
    15-minute root polling before replacing it.
