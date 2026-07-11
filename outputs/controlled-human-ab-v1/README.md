# Controlled Human A/B workbook boundary

- `rater/AgentProof-Human-AB-Rater-Workbook-Template-v1.xlsx` is the isolated rater template. Create one copy per reviewer only after assignment preflight passes.
- `coordinator/AgentProof-Human-AB-Coordinator-Summary-v1.xlsx` is coordinator-only and must never be sent to raters.
- `AgentProof-Human-AB-Evaluation-Sheet-v1.xlsx` is the preserved earlier combined workbook. It contains Labels and Summary together and is superseded; do not distribute or use it for controlled labeling.
- `dev10-smoke/` is reserved for a future isolated one-run dev smoke. It must never overwrite `eval/llm-proof-planner-semantic-integrity-*`.

No workbook contains the D/L arm key. Rater workbooks must contain one pseudonymous reviewer only.

Current blocker: artifact-tool 2.8.6 accepted the freeze-pane API calls but did not serialize a `<pane>` into the exported worksheet XML. The workbooks use Excel tables with persistent filter headers, but they must not be distributed as final rater files until the frozen Labels header is independently verified.
