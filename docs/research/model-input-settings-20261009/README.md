# AgentProof: input, exploration and reasoning research packet
Snapshot 2026-10-09. This is a research-only snapshot, not a production release.

## Product and scope
AgentProof produces evidence reports for PR purposes. Deterministic source provenance, SHA, ID, quote and server-owned execution checks precede model interpretation. Current experimental flow: cumulative source exploration -> one final interpretation; checker/refinement/retry zero. Source tests are not executed tests.

## Observations, not model rankings
Frozen existing 3 PRs: expressjs/express #7442 and #7425; go-chi/chi #1166. Same frozen purpose and initial file inventory for Gemini/Haiku, but prompts, schema translations and repository return semantics were NOT identical. One run per case. Do not treat completion as semantic correctness.
Sol reference run: 3/3 completed, 54.29/71.69/97.42 sec, total estimated $0.362034; constraints differ from later runs.
Gemini HIGH: 3/3, 203.12/68.79/238.55 sec, estimated $0.3807435, 14 generation+14 count. Output 67868 tokens includes 59156 thinking tokens (87.2%). Thinking token estimated cost $0.221835, 58.3% total. Workflow final call alone 146.62sec. Chi input per call 3311/4807/25624/28318/32073/16988 tokens.
Haiku adaptive/high: 2/3, 31.70/92.72/33.36 sec, estimated $0.0194372, 9 generation+9 count. Workflow failure was a direct quote with two source IDs, not a false quote. Express7425 model requested full source/test files plus repository search, causing 213 blob reads/58.28sec. Chi model read head3 of6 changed files and stopped despite exposed base/head IDs.
Haiku disabled/high: 3/3 schema/closure accepted, 12.791/14.064/13.510sec, estimated $0.0108151. 9 generation+9 count, all thinking usage0. Workflow and express7425 base unread; chi only1 of6 changed files base/head read, partial_access despite no read failure. Accessible core evidence still omitted despite stronger stop instruction.

## Proven server differences
Gemini HIGH evaluation materialize automatically returns WHOLE complete non-JS/TS files even when model asks lines1-20. Haiku HIGH preserves non-JS ranges, but may expand JS syntax units. Haiku OFF disables JS expansion too. See range excerpts. Server expansion is distinct from model-requested extra reading. Haiku OFF also removes candidateMetadata duplicated from selectionSources and strengthens stop prompt. Thus OFF vs HIGH results cannot isolate thinking causality.
Exact duplicate full content fields within individual analyzed inputs: none found by string matching. Earlier source is resent across calls to maintain context; results/readOutcomes/candidate metadata add repeated structure. Byte proportions are not token proportions. Do not discard earlier evidence simply to save tokens.

## Runtime constraints and unresolved support
Recent direct evaluations: total$1 cap, max8 exploration calls + final1 percase; no app line/byte/read/action/time/6000output cap; provider/infrastructure limits remain. No retries/response correction. Haiku disabled supported in runtime metadata; Sol6.1 and Gemini3.8 excluded from OFF run after official docs review reported no complete OFF support; independently verify current official support before recommending settings. LOW is not OFF.
Jev code exists (jev-1.13.0 experiment) but was not run in latest comparison; do not assume it is interchangeable with text-generation models.

## Reading guide
Read metrics and reports first; input-analysis contains per-call sizes/time/token/cost. code-* files are current uncommitted product snapshots supplied for architecture review; evaluation forks differed as described. Prompt before/after and wire transformation provided explicitly. No live credentials, raw private HTTP requests/SSE, deployment hosts, or local secret files are included. Code snapshot imports may refer to existing main-branch modules; this packet is for review, not a runnable release.

## Questions for Pro
Identify controllable input/tool/planning/termination/schema/reasoning settings that improve purpose-grounded coverage while reducing time/cost. Separate proven defects from hypotheses. Propose a minimal general design, exact changed interfaces/prompt wording/pseudocode, logging and controlled experiments. No fixture-specific rules; no blanket whole-repo or module reading; no mandatory LLM checker. Preserve honest unresolved scope, exact source provenance, privacy and server-owned execution authority. Prompt compliance alone is not a deterministic completion guarantee.
