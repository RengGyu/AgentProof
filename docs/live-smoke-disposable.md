# Live Smoke Disposable PR

This temporary document exists only to create a harmless pull request for the controlled GitHub App live smoke.

It must not include webhook payloads, tokens, private keys, raw diffs, logs, full reports, comment bodies, or saved report contents.

Expected validation:

- AgentProof can fetch this PR with the configured GitHub App installation.
- The live smoke reports bounded metadata only.
- The target PR receives no AgentProof marker comment.
- Saved reports remain suppressed unless explicitly allowed.
