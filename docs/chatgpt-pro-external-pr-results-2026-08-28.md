# AgentProof external PR evidence reports for independent review

**Reports:** 25
**Scope:** Public PR URL batch

# AgentProof evidence report

**Repository:** microsoft/TypeScript
**PR:** #64032
**Head SHA:** cb2513cbec121631638c7041448273029e1b0d54
**Analyzed:** 2026-08-28T05:17:55.914Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** Linked Issue

## Requirements

- **jsdoc link name**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_4

- **[Playground Link](https://www.typescriptlang.org/play/?ssl=4&ssc=20&pln=1&pc=1#code/PQKhFgCgQAgbwAIBsCWA7A1jAxAFwPYDmhSApgCYC+MADgE742l24CeUIwUpAHjfixgBjfGgDOuGDxgBeGAEYA3EA)**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_27, ev_28

- **Using the TS API to get the name jsdoc link tag produces node containing JSDocText property (the next sibling node)**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_3, ev_5

- **The name property of the link should be undefined as in 6.0**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_3, ev_5

## Checks

- CI: passed
- Lint: passed
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** denoland/deno
**PR:** #36592
**Head SHA:** b87f658fb333718816149ac78ec90b4fe18555db
**Analyzed:** 2026-08-28T05:18:00.214Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** PR objectives

## Requirements

- **In the TDS protocol, TLS is tunneled through `PRELOGIN` packets, and SQL Server does not support TLS session resumption during TDS prelogin handshakes**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_3, ev_4

- **Implemented `NodeClientSessionStoreWrapper` in `ext/node/ops/tls_wrap.rs` to gate session resumption offers behind an `allow_resumption` flag (default `false`), toggled from JS via a dedicated `setSessionAllowed(bool)` fast op**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_3, ev_4

- **When `options.session` is passed or `socket.setSession()` is called, `allow_resumption` is enabled only if `syntheticSessionMatches` validates that the ticket matches the destination host/port. `tls.connect()` applies the session before initiating the connection, so the gate is set before the handshake can start**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_4, ev_6, ev_7, ev_8, ev_9, ev_10, ev_11, ev_12, ev_13

- **On `kReinitializeHandle` (Happy Eyeballs / `autoSelectFamily` fallback), resumption is re-enabled on the re-created handle only when the session previously passed validation**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_4

- ****Second fix (uncovered by the regression test):** opt-in resumption silently never worked after `tls.setDefaultCACertificates()`. rustls only offers a stored session when the config's verifier `Arc` is the same instance the session was stored under, and `build_client_config` left the cached-verifier path whenever a process-level custom CA was set, building a fresh verifier per connection. Connections whose only non-default input is the process-level custom CA now stay on the cached path; `op_set_default_ca_certificates` already invalidates the cached verifiers whenever the CA list changes**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_4

- **Known limitation (documented in `_init`): a directly constructed `new tls.TLSSocket(socket, { session })` (not via `tls.connect()`) does not resume — there are no connect options to validate the synthetic session against**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_3, ev_4

- **Tests in `tests/unit_node/tls_test.ts`: per-connection opt-in/opt-out steps (including a well-formed session for a different host:port), resumption after `setDefaultCACertificates()`, and session preservation across the `autoSelectFamily` fallback handle re-creation**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_3, ev_4, ev_7, ev_12, ev_17, ev_21, ev_25, ev_32, ev_36, ev_40

- **Tested with `cargo test --test unit_node tls` and `cargo test --test node_compat test-tls-client-resume`**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_3, ev_4, ev_7, ev_8, ev_10, ev_12, ev_13, ev_17, ev_18, ev_19

## Checks

- CI: passed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** microsoft/TypeScript
**PR:** #64042
**Head SHA:** fdfe3afe5da581a757a56814c271e44852d9d3ea
**Analyzed:** 2026-08-28T05:18:04.369Z
**State:** CURRENT
**Priority:** high
**Analysis context:** PR objectives

## Requirements

- **The crash is fixed just by cloning the node instead of mutating it**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_5, ev_9

- **So this PR applies a refactor to keep change tracker edits in virtual coordinates until the very end when retrieving the final LSP edits**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_5, ev_6, ev_7, ev_9

## Checks

- CI: passed
- Lint: passed
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** astral-sh/ruff
**PR:** #28022
**Head SHA:** 5ced6e54cd0ce53a7da99bbfeaea1d9235a18bc9
**Analyzed:** 2026-08-28T05:18:09.200Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** Linked Issue

## Requirements

- **The DTZ901 / datetime-min-max lint should alert that a naive datetime is being used here, but it doesn't**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_4

## Checks

- CI: passed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** django/django
**PR:** #21820
**Head SHA:** 152c456e1f3dd204bd4505d0a6f2371ddaa303bc
**Analyzed:** 2026-08-28T05:18:12.424Z
**State:** CURRENT
**Priority:** high
**Analysis context:** PR objectives

## Requirements

- No explicit requirement or PR objective was found.

## Checks

- CI: passed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** scikit-learn/scikit-learn
**PR:** #34815
**Head SHA:** b851d69eea450212c3f9ffc0541d3810dd001bc2
**Analyzed:** 2026-08-28T05:18:16.242Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** PR objectives

## Requirements

- **Code generation (e.g., when writing an implementation or fixing a bug)**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_8, ev_9, ev_23

## Checks

- CI: passed
- Lint: passed
- Typecheck: passed

---

# AgentProof evidence report

**Repository:** rust-lang/rust
**PR:** #161012
**Head SHA:** 27012419b2e7695842b0c1d4a95be65244b06093
**Analyzed:** 2026-08-28T05:18:19.491Z
**State:** CURRENT
**Priority:** high
**Analysis context:** Linked Issue

## Requirements

- **from tests/ui/coroutine/issue-58888.rs**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_5, ev_6, ev_19, ev_22

- **<details><summary><strong>Backtrace</strong></summary>**
  - Observed evidence: missing
  - Requirement outcome: unclear
  - Evidence IDs: Unavailable

## Checks

- CI: passed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** apache/maven
**PR:** #12659
**Head SHA:** 7e89d0df77cd24fe7f7024782a7035d7a8c57775
**Analyzed:** 2026-08-28T05:18:23.371Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** PR objectives

## Requirements

- **[x] Write unit tests that match behavioral changes, where the tests fail if the changes to the runtime are not applied**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1

- **Maven 3's `ReactorReader` returns the reactor project's build POM for every artifact request whose extension is `pom`, before considering the classifier**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_19, ev_20, ev_21, ev_27, ev_28, ev_29

- **Consequently, resolving an attached classified POM from the reactor returns `pom.xml` instead of the attached artifact**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2

- **A focused unit test reproduces the incorrect path before the fix and verifies the attached POM afterward**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2

- **Regression test before the fix: expected `custom.pom`, but `ReactorReader` returned `pom.xml`**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2

- **Full root `mvn verify`: all 16 modules passed with RAT, Checkstyle, Spotless, Animal Sniffer, and unit tests enabled**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_4, ev_5, ev_6, ev_7, ev_8, ev_9, ev_10, ev_11

- **`maven-core`: 367 tests, 0 failures, 0 errors, 1 skipped**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_27, ev_28, ev_29

- **Complete unfiltered Maven 3.10.x Core IT suite with `run-its,embedded`: all 78 modules passed; 867 tests, 0 failures, 0 errors, 39 skipped**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_27, ev_28, ev_29

## Checks

- CI: passed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** home-assistant/core
**PR:** #179202
**Head SHA:** 1ddee1279126a22c077221268597e4463bf9c3ab
**Analyzed:** 2026-08-28T05:18:26.866Z
**State:** CURRENT
**Priority:** high
**Analysis context:** Linked Issue

## Requirements

- **For an ESPHome climate entity with no two-point target temperature support, the temperature attribute is null whenever hvac_mode is auto, even though the entity advertises ClimateEntityFeature.TARGET_TEMPERATURE**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_3, ev_5, ev_43

- **A device with neither two-point flag has no target_temperature_low/high, so it should never fall through to None**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_3

## Checks

- CI: passed
- Lint: passed
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** grafana/grafana
**PR:** #131171
**Head SHA:** 5b409937267f0a52283ca75ac6b175845d190a5e
**Analyzed:** 2026-08-28T05:18:31.218Z
**State:** CURRENT
**Priority:** high
**Analysis context:** PR objectives

## Requirements

- **Fixes a race condition where two requests rotating the same session token concurrently could leave one of them holding a session token that looks accepted at the time but silently stops working once the next rotation cycle happens — a forced logout with no prior warning**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2, ev_65

- **`pkg/services/auth/authimpl/auth_token.go`: gate the skip-rotation fast path on the presented token still hashing to the current `auth_token` value; if it only matches the previous slot, perform a real rotation instead of returning it unchanged**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_3, ev_65

- **`pkg/services/auth/authimpl/auth_token_test.go`: added a regression test reproducing the forced-logout sequence, and corrected two pre-existing tests whose assertions had locked in the old (buggy) behavior as intentional**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2, ev_3, ev_40, ev_44, ev_65, ev_35

- ****Risk Level**: Low — change is scoped to a single function in one file, covered by existing and new unit tests, no schema or public API changes**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2, ev_6, ev_21

- **Standard revert — no feature flag involved; this fixes existing, always-on rotation logic rather than introducing a new code path**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2, ev_65

## Checks

- CI: passed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** nuxt/nuxt
**PR:** #36181
**Head SHA:** 0225314bc1d74d5d4f1c9ab56799d0c46ddd5bd7
**Analyzed:** 2026-08-28T05:18:35.606Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** PR objectives

## Requirements

- **small fix to improve dx - otherwise this would error later on, confusingly..**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2

## Checks

- CI: passed
- Lint: unknown
- Typecheck: passed

---

# AgentProof evidence report

**Repository:** dotnet/runtime
**PR:** #132351
**Head SHA:** 1e7b0fbdb0702738bba8254e153b714b37f8597a
**Analyzed:** 2026-08-28T05:18:37.230Z
**State:** CURRENT
**Priority:** high
**Analysis context:** Linked Issue

## Requirements

- **There are two overloads of this helper, and they are character-for-character identical in how they handle ownership:**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_3

## Checks

- CI: passed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** spring-projects/spring-framework
**PR:** #36045
**Head SHA:** 1b354f2705f624ea090eab2bd6099a6c4c2a22fe
**Analyzed:** 2026-08-28T05:18:40.087Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** PR objectives

## Requirements

- **Deprecate Derby support since Apache Derby is retired since 2023**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_3, ev_4, ev_6, ev_8, ev_9, ev_10

## Checks

- CI: passed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** sveltejs/svelte
**PR:** #18729
**Head SHA:** 0656100177add804210c3a9e9784c904678f9ef5
**Analyzed:** 2026-08-28T05:18:42.878Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** PR objectives

## Requirements

- **supports later ubuntu versions**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_4, ev_5, ev_6, ev_7, ev_23, ev_24, ev_25

## Checks

- CI: passed
- Lint: passed
- Typecheck: passed

---

# AgentProof evidence report

**Repository:** microsoft/TypeScript
**PR:** #64045
**Head SHA:** b18eaa217345bc9ee80d2987afbf7153c9dabfee
**Analyzed:** 2026-08-28T05:18:47.068Z
**State:** CURRENT
**Priority:** low
**Analysis context:** PR objectives

## Requirements

- No explicit requirement or PR objective was found.

## Checks

- CI: passed
- Lint: passed
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** django/django
**PR:** #21836
**Head SHA:** c1b0b4bc73cf15dfc579375718f55c8311b2d26a
**Analyzed:** 2026-08-28T05:18:49.883Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** PR objectives

## Requirements

- **Fixed the spelling of 'TalkBack' and added missing hyperlink**
  - Observed evidence: unclear
  - Requirement outcome: unclear
  - Evidence IDs: ev_1

## Checks

- CI: unknown
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** astral-sh/ruff
**PR:** #27910
**Head SHA:** e20dedb72c0f517189438b4943bfc64860436382
**Analyzed:** 2026-08-28T05:18:54.174Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** PR objectives

## Requirements

- **I think we could also update our rule request template based on some of these guidelines, but I'll save that for a follow-up once these are solidified**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_3, ev_5, ev_6

## Checks

- CI: passed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** microsoft/TypeScript
**PR:** #64048
**Head SHA:** f3bba9cf8c363ea08e67f4d50afaea18d7558daf
**Analyzed:** 2026-08-28T05:18:58.254Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** PR objectives

## Requirements

- No explicit requirement or PR objective was found.

## Checks

- CI: passed
- Lint: passed
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** dotnet/runtime
**PR:** #132794
**Head SHA:** 7cab8c7fb2d473081e9b61bd1ff54db8b002806c
**Analyzed:** 2026-08-28T05:18:59.647Z
**State:** CURRENT
**Priority:** blocker
**Analysis context:** PR objectives

## Requirements

- **Document that `AsyncValidationAttribute` implementations must observe cancellation promptly**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_62

- **Explain that ignoring cancellation can delay validation failure and short-circuiting because started validation tasks are awaited before returning**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2, ev_62

- **Document timeout-configured cancellation tokens for callers that need to bound validation time**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_1, ev_2, ev_62

## Checks

- CI: failed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** prometheus/prometheus
**PR:** #19497
**Head SHA:** 0c6c2dff287fd66a6b60abcf597bd7b82fff41c9
**Analyzed:** 2026-08-28T05:19:04.594Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** PR objectives

## Requirements

- No explicit requirement or PR objective was found.

## Checks

- CI: passed
- Lint: passed
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** kubernetes/kubernetes
**PR:** #141071
**Head SHA:** 47003ce61dc60af3bc64986dc303d1c0729d174c
**Analyzed:** 2026-08-28T05:19:06.066Z
**State:** CURRENT
**Priority:** blocker
**Analysis context:** PR objectives

## Requirements

- **This PR standardizes `PodGroup` and `CompositePodGroup` key management across the scheduler framework by returning type-safe `EntityKey` structs directly from `PodGroupInfo.GetKey()`**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_3, ev_4, ev_7, ev_8, ev_10

- ****`PodGroupInfo.GetKey()`**: Updated the interface method and concrete implementations to return `fwk.EntityKey` instead of `string`**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_3, ev_4, ev_7, ev_8, ev_10

- ****Removed `pgKey()` Helper**: Cleaned up internal scheduler logic (`schedule_one_podgroup.go`) and unit tests by removing the package-level `pgKey()` helper function and calling `.GetKey()` directly on `PodGroupInfo` instances**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_3, ev_4, ev_7, ev_8, ev_10, ev_17

- **Verified with `make test WHAT=./pkg/scheduler/...` and `make test-integration WHAT=./test/integration/scheduler/podgroup`**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_3, ev_4, ev_7, ev_8, ev_10, ev_19

## Checks

- CI: failed
- Lint: passed
- Typecheck: passed

---

# AgentProof evidence report

**Repository:** django/django
**PR:** #21845
**Head SHA:** f60c82bd621d33e780d34ee1d593ddbad479a16a
**Analyzed:** 2026-08-28T05:19:09.081Z
**State:** CURRENT
**Priority:** high
**Analysis context:** PR objectives

## Requirements

- No explicit requirement or PR objective was found.

## Checks

- CI: passed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** apache/kafka
**PR:** #23284
**Head SHA:** c44fe00ddda8e7a36730706455ea95440cc26380
**Analyzed:** 2026-08-28T05:19:10.624Z
**State:** CURRENT
**Priority:** blocker
**Analysis context:** PR objectives

## Requirements

- **As reported in KAFKA-20989, the KRaft controller creates persistent sequential notifications for config changes and ACL changes when in migration mode**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2

- **While clusters remain in this mode, /config/changes, /kafka-acl-changes, and /kafka-acl-extended-changes keep growing without deletion**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2

## Checks

- CI: failed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** flutter/flutter
**PR:** #190874
**Head SHA:** 643f07dcd838eb47cf2b1a2b5f25653351a95dab
**Analyzed:** 2026-08-28T05:19:13.735Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** PR objectives

## Requirements

- **Adds direct support for linear and radial gradient color sources to UberSDF, enabling single-pass rendering of these gradients without the multi-pass blending that is currently used**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2, ev_3, ev_4, ev_5, ev_6, ev_7, ev_8, ev_9

- **Adds a color_source_sampler input to UberSDF, which is used to sample a texture representing the gradient color ramp for a linear or radial gradient. This sampler may also be extended in the future for image-based color sources, but that is outside the scope of this PR**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2, ev_3, ev_4, ev_5, ev_6, ev_7, ev_8, ev_9

- **Adds properties to UberSDFParameters and to UberSDF's FragInfo for specifying gradient properties**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_5, ev_6, ev_7, ev_8, ev_9, ev_10, ev_11

- **Updates `Canvas::AddRenderSDFEntityToCurrentPass` to fill in the gradient texture and gradient related properties when `paint.color_source` is a gradient supported by UberSDF**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_4, ev_5, ev_6, ev_7, ev_8, ev_9, ev_10, ev_11, ev_15, ev_55, ev_56

- **This supports only linear and radial gradients**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2, ev_3, ev_5, ev_6, ev_7, ev_9, ev_10, ev_11

- **It does not support conical and sweep gradients**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2, ev_5, ev_6, ev_7, ev_9, ev_10, ev_11, ev_12

- **Supporting conical and sweep gradients would require additional complexity to UberSDF, so it may not be worth it**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2, ev_5, ev_6, ev_7, ev_8, ev_9, ev_10, ev_11, ev_55

- **This can be further improved in a follow up PR by adding caching for gradient textures, similar to TextShadowCache in ContentContext**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_2, ev_3, ev_4, ev_5, ev_6, ev_7, ev_9, ev_10

## Checks

- CI: passed
- Lint: unknown
- Typecheck: unknown

---

# AgentProof evidence report

**Repository:** kubernetes/kubernetes
**PR:** #141358
**Head SHA:** 1df2c1b5740352c4eb4aa2c5b688facc5394ba80
**Analyzed:** 2026-08-28T05:19:15.150Z
**State:** CURRENT
**Priority:** medium
**Analysis context:** PR objectives

## Requirements

- **Sync their RBACs and CRDs from the external-snapshotter v8.6.0 and enable them in all test configurations / jobs**
  - Observed evidence: partial
  - Requirement outcome: unclear
  - Evidence IDs: ev_5

## Checks

- CI: passed
- Lint: passed
- Typecheck: passed

---
