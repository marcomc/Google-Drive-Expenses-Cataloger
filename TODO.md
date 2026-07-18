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

- [ ] **Publish the first release after review**
  - Review the full diff and repository-publication privacy boundary.
  - Commit, tag, and publish only after explicit approval.
