# Hybrid planner private-pilot runbook

The hybrid requirement planner is opt-in and disabled by default. It is
available only when the repository is private, the repository grant is in
enhanced mode with the exact current consent version, the tenant is on the
bounded operator allowlist, and the global pilot flag is exactly `true`.
Every submit, retrieval, and finalization re-evaluates the gates.

## Manual rollback

1. Set `AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED=false` in the deployment
   configuration.
2. Remove affected tenant IDs from
   `AGENTPROOF_HYBRID_PROOF_PILOT_TENANT_ALLOWLIST`.
3. Restart or redeploy the application using the normal operational process.
4. Confirm from bounded planner telemetry that subsequent analyses have a
   POST count of zero and a disabled outcome.

The switch is manual. AgentProof does not automatically change the flag,
allowlist, repository grants, or consent. A job already queued with hybrid
intent re-reads the gates before submit. A job already waiting for a provider
response may perform only a GET for its existing opaque response ID; once a
gate is disabled, it returns deterministic fallback and cannot submit again.

## Expansion pause criteria

After at least 100 eligible attempts, pause allowlist expansion for operator
review when either condition is true:

- planner elapsed-time p95 is greater than 35 seconds;
- invalid-output plus overflow fallback is greater than 5 percent.

Use only the bounded aggregate fields approved for planner telemetry. Do not
copy source text, paths, evidence, decisions, prompts, outputs, response IDs,
input hashes, repository names, logs, checks, tokens, or secrets into an
operator note.

## Safe validation

Use simulated provider responses and local test stores for pre-deployment
validation. Do not grant tenant access or apply the migration as part of a
test run. Confirm both active legacy `false + null/null` rows and hybrid-intent
rows: legacy jobs keep their existing retry protocol; hybrid jobs make at most
one POST and never repair, retry, subset, or re-submit.
