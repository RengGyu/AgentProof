# General PR Freshness Ordering and Reasons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 파일·체크 목록의 순서 변화로 인한 불필요한 semantic 결과 폐기를 막고, 실제 확인한 변경 사유만 표시한다.

**Architecture:** 기존 seed 생성과 descriptor 재구성에 작은 공통 목록 정렬 helper를 적용한다. 네 freshness fence는 유지하고 기존 private reason과 public reason/presenter의 연결만 교정한다.

**Tech Stack:** 현재 Node.js 22, pnpm 10.32.1, TypeScript, Vitest, Node crypto 및 표준 Array/JSON API. 새 의존성 없음.

**Spec:** [freshness 순서 안정화·사유 정확화 명세](../specs/2026-09-04-general-pr-freshness-ordering-and-reasons-design.md)

**Status:** 사용자 승인 범위의 구현·회귀 테스트·전체 로컬 gate·독립 재검토 완료. 아래 체크리스트는 원래 실행 절차이며 실제 실행 근거는 하단 진행 기록을 기준으로 한다. commit/push/deploy/live 미실행.

## Global Constraints

- 제품은 evidence report이며 일반 코드 리뷰·merge/release gate가 아니다.
- source authority, claim admission, ownership, Supported/Contradicted ceiling은 변경하지 않는다.
- 최대 provider 호출 2회, semantic 총 budget 60초, 기본 retry·모델·프롬프트·선택 한도는 변경하지 않는다.
- 네 freshness fence와 실패 시 semantic proposal 전체 보류는 유지한다.
- 공개/저장 schema의 필드·enum·서명 payload는 추가하거나 변경하지 않는다. 과거 summary backfill은 하지 않는다.
- 토큰·원문·raw provider 응답·새 private digest를 저장하거나 공개하지 않는다.
- 새 dependency, 실행 sandbox, collector 재작성, PR별 예외를 추가하지 않는다.
- 이 문서는 구현·commit/push·배포·유료/live API 호출 승인이 아니다.

## 시작 상태·작업 분배

- 기준 worktree `/private/tmp/agentproof-general-pr-hybrid-observation-impl`, branch `codex/general-pr-hybrid-observation-impl`, HEAD `1486d9be01ef72e0b7ad50c318459c98ea46ffbc`.
- 기존 untracked `general-pr-local-boundary-diagnostics.test.ts`와 9월 3일 진단 명세/계획은 사용자 작업으로 보존한다. 현재 명세/계획도 local-only다. main checkout에서 재구현하거나 전체 파일을 stage하지 않는다.
- Sol이 범위/설계를 소유하고, Terra(high까지 필요에 따라)가 Task 1→2→3을 순차 구현한다. worker에는 WORKER_RUNTIME_RULES와 해당 task의 명세 ID/파일/수용 테스트만 전달한다. 독립 Sol은 편집/테스트 없이 diff를 검토한다.
- 공통 test/build 상태를 두 agent가 동시에 수정·실행하지 않는다. 30분 초과 전망이면 사용자에게 중간 보고하고 무관한 실패를 계속 고치지 않는다.

- [ ] 구현 승인 후 실제 baseline을 기록한다.

```sh
git branch --show-current
git rev-parse HEAD
git status --short
git diff --stat
```

- [ ] 현재 동작 baseline을 실행한다. 아래는 연구 시 5 files/115 passed였지만 구현자는 자신의 출력을 다시 기록한다.

```sh
pnpm exec vitest run src/lib/general-pr-local-boundary-diagnostics.test.ts src/lib/general-pr-observation-source.test.ts src/lib/general-pr-semantic-evidence-selection.test.ts src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-assessment.test.ts
```

## Task 1 — seed와 descriptor에 동일 목록 순서 적용

**Spec:** F1, A1–A6. **수정:** `src/lib/general-pr-observation-source.ts`, `src/lib/general-pr-semantic-evidence-selection.ts`. **테스트:** 각 `.test.ts`, 기존 `general-pr-local-boundary-diagnostics.test.ts`의 freshness 부분.

**Consumes:** 기존 PullRequestInput, seed V2, `completeInput`/`selected` evidence-selection 테스트 helper.

**Produces:** `canonicalizeGeneralPrObservationCollectionsV1(input: Pick<PullRequestInput, "changedFiles" | "checks">): Pick<PullRequestInput, "changedFiles" | "checks">`. 기존 seed/selection 함수 signature는 변경하지 않는다.

- [ ] **RED:** source 테스트의 `input` helper로 3개 파일/3개 체크를 만들고 아래 순열 테스트를 추가한다. 실제 구현 helper로 기대값을 생성하지 않는다.

```ts
function permutations<T>(items: T[]): T[][] {
  return items.length < 2 ? [items] : items.flatMap((item, index) =>
    permutations(items.filter((_, other) => other !== index))
      .map((tail) => [item, ...tail]));
}

it("keeps the full seed invariant under file/check permutations", () => {
  const original = input({
    changedFiles: [
      { path: "src/z.ts", status: "modified" },
      { path: "test/z.test.ts", status: "added" },
      { path: "docs/a.md", status: "modified" }
    ],
    checks: [
      { name: "z-unit", status: "passed" },
      { name: "a-lint", status: "passed" },
      { name: "b-type", status: "passed" }
    ]
  });
  const untouched = structuredClone(original);
  const expected = buildGeneralPrObservationSeedV2(original);
  for (const changedFiles of permutations(original.changedFiles)) {
    for (const checks of permutations(original.checks)) {
      expect(buildGeneralPrObservationSeedV2({ ...original, changedFiles, checks }))
        .toEqual(expected);
    }
  }
  expect(original).toEqual(untouched);
});
```

- [ ] evidence-selection 테스트에서 `completeInput`에 위 3개 목록을 넣고 `selected(request).selection` 전체를 순열끼리 비교한다. path/hunk label/check name을 서로 다른 표식으로 만들어 descriptor가 다른 원소에 붙지 않았는지도 검사한다. 정상 seed만 정렬하고 descriptor 입력은 정렬하지 않는 구현이면 이 테스트가 실패해야 한다.
- [ ] 같은 name/status의 서로 다른 workflow/run/attempt/job, 중복 체크, 중복·충돌 fileRef, 한 필드씩 변경, 원본 freeze 및 helper idempotence를 추가한다. 중복 체크 수는 유지, 중복 fileRef는 기존 descriptor_invalid로 남아야 한다.
- [ ] source/span 문장 순서와 ordered execution parents는 기존 테스트 및 대조군으로 보호한다. timestamp만 바뀌는 경우는 기존처럼 seed가 같아야 한다. patch/summary/URL이 hash에 새로 포함됐다고 기대하지 않는다.

```sh
pnpm exec vitest run src/lib/general-pr-observation-source.test.ts src/lib/general-pr-semantic-evidence-selection.test.ts src/lib/general-pr-execution-envelope.test.ts
```

- [ ] **GREEN:** source 파일에 아래 작은 구현을 추가한다. 이 코드는 문서상의 제안이며 아직 적용되지 않았다. 현재 execution-envelope 정규화와 대조한 뒤 적용한다.

```ts
export function canonicalizeGeneralPrObservationCollectionsV1(
  input: Pick<PullRequestInput, "changedFiles" | "checks">
): Pick<PullRequestInput, "changedFiles" | "checks"> {
  return {
    changedFiles: orderByKey(input.changedFiles, (file) => JSON.stringify([
      file.path.replace(/\\/g, "/"), file.previousPath ?? null,
      file.status ?? "unknown"
    ])),
    checks: orderByKey(input.checks, (check) => {
      const identity = check.workflowExecutionIdentity;
      return JSON.stringify([
        check.name, check.status,
        identity?.workflowPath || null,
        identity ? String(identity.workflowId) : null,
        identity ? String(identity.runId) : null,
        identity && Number.isSafeInteger(identity.runAttempt) && identity.runAttempt > 0
          ? identity.runAttempt : null,
        identity ? String(identity.jobId) : null
      ]);
    })
  };
}

function orderByKey<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
  return values.map((value) => ({ value, key: keyOf(value) }))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    .map(({ value }) => value);
}
```

- [ ] `buildGeneralPrObservationSeedV2`에서 `const { changedFiles, checks } = canonicalizeGeneralPrObservationCollectionsV1(input)`을 얻고, change builder와 두 check 순회에 사용한다. executions/check atoms의 index는 이 순서에서 함께 부여한다. 기존 digest/ID schema는 수정하지 않는다.
- [ ] evidence selector가 `buildDescriptorCatalogs`에 다음 입력을 전달하게 한다. claim 원문/순서 검증은 건드리지 않는다.

```ts
const catalogs = buildDescriptorCatalogs({
  ...input.pullRequest,
  ...canonicalizeGeneralPrObservationCollectionsV1(input.pullRequest)
}, input.seed);
```

- [ ] 기존 local-boundary 진단의 check/file order 기대값만 이제 동일 seed로 바꾼다. 순서 변화가 stale이라는 옛 회귀를 그대로 두지 않는다. actual-change 대조군과 ownership/routing 검사는 유지한다.
- [ ] RED 명령을 재실행하고 typecheck를 실행한다. 배열 snapshot/index를 대량 갱신하지 말고 바뀐 각 assertion의 의미를 설명한다. Task 1은 seed와 descriptor를 함께 마친 뒤 검토한다.

## Task 2 — freshness 사유와 공개 문구 교정

**Spec:** F2, A8. **수정:** `src/lib/general-pr-semantic-observer.ts`, `src/lib/general-pr-assessment.ts`, `src/lib/general-pr-assessment-presentation.ts`. **테스트:** 각각 `.test.ts` 및 기존 local-boundary 진단.

**Consumes:** Task 1 builder와 기존 GeneralPrFreshnessFailureV1. **Produces:** 기존 enum을 그대로 사용하는 더 정확한 reason; 공개 schema 변경 없음.

- [ ] **RED:** observer 테스트의 `input`, `run`, `stagedProvider`를 재사용한다. 정상 anchor 둘이 있는 입력에서 head만/base만/둘 다 변경, anchor 한쪽 null/빈 문자열, check status 변경, source 변경을 별도 행으로 검사한다. typed 예외와 정상 재수집 경로를 모두 포함한다.
- [ ] assessment 테스트에서 real finalizer를 사용해 head_changed만 head_mismatch를 생성하는지 검사한다. base/source/seed_changed, legacy stale/no reason, seed/bundle 불일치에는 head_mismatch가 없어야 한다. 기존 테스트 `retains linked-Issue source state with zero targets and marks stale ownership ambiguous`의 기대를 이 명세에 맞게 교정한다.

```ts
const seed = buildGeneralPrObservationSeedV2(input());
const bundle = finalizeDeterministicGeneralPrObservationsV2(
  seed, null, "stale", undefined, undefined, undefined, undefined,
  undefined, undefined,
  { freshnessFailure: { phase: "after_claim", state: "stale", reason: "seed_changed" } }
);
const assessment = deriveGeneralPrAssessmentV1({ seed, bundle, report });
expect(assessment.reasonCodes).not.toContain("head_mismatch");
expect(assessment.reasonCodes).toContain("source_ambiguous");
expect(assessment.observations?.links.state).toBe("unavailable");
```

- [ ] presenter에서 legacy `head_mismatch`가 확정적 head 이동 문구를 출력하지 않는지 검사한다. 저장된 reason은 그대로 유지한다.

```sh
pnpm exec vitest run src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-assessment.test.ts src/lib/general-pr-assessment-presentation.test.ts
```

- [ ] **GREEN:** `readCurrentPublicSubject`의 성공한 fetch 분기를 아래처럼 바꾼다. 앞의 예외/null/privacy 처리와 네 fence 호출은 유지한다.

```ts
const currentSeed = buildGeneralPrObservationSeedV2(currentInput);
if (expectedSeed.headSha && currentSeed.headSha &&
    currentSeed.headSha !== expectedSeed.headSha) {
  return { state: "stale", reason: "head_changed" };
}
if (expectedSeed.baseSha && currentSeed.baseSha &&
    currentSeed.baseSha !== expectedSeed.baseSha) {
  return { state: "stale", reason: "base_changed" };
}
return currentSeed.seedHash === expectedSeed.seedHash
  ? { state: "current" }
  : { state: "stale", reason: "seed_changed" };
```

- [ ] assessment의 `headMismatch` 조건만 explicit head-change 진단으로 제한한다. non-head mismatch는 기존 sourceStateFor의 ambiguous/기존 source_ambiguous fallback을 사용한다. targets, counts, headBound, sourceStateFor와 observationsFor의 차단은 삭제하지 않는다.

```ts
const headMismatch = bundle.semanticFreshnessFailure?.state === "stale" &&
  bundle.semanticFreshnessFailure.reason === "head_changed";
```

- [ ] 공통 presenter의 head_mismatch 문구만 `Collected evidence could not be matched to the analyzed snapshot.`으로 바꾼다. types/allowlist/tenant signature와 저장 데이터에는 손대지 않는다. 기존 summary 검증에서 새 enum이 필요해진다면 다른 방향으로 확장하지 말고 보고한다.
- [ ] RED 명령과 local-boundary 진단을 재실행한다. 수정은 사유 정확화이며 결과를 supported로 바꾸지 않았음을 diff로 확인한다.

## Task 3 — 실제 연결 경로·안전 경계 검증과 로컬 종료

**Spec:** F3, A7/A9/A10. **제품 수정 예정 없음.** 기존 observer/service/observation-worker/assessment/route/codec 테스트를 보강한다. 공통 테스트 utility 파일이나 새 평가 프레임워크는 만들지 않는다.

**Consumes:** Task 1/2 적용 결과. **Produces:** RED/GREEN·실제 명령·남은 불확실성 기록. 새 live 결과는 산출하지 않는다.

- [ ] observer의 기존 `stagedProvider`/`run`으로 네 fence를 한 표로 검사한다. 아래 예시는 기존 input helper가 있는 observer test 안에 둔다.

```ts
it.each([
  [1, "before_claim", 0], [2, "after_claim", 1],
  [3, "before_evidence", 1], [4, "after_evidence", 2]
] as const)("rejects a changed check at read %i", async (at, phase, calls) => {
  const original = input();
  const changed = { ...original, checks: original.checks.map((check) =>
    ({ ...check, status: "failed" as const })) };
  const provider = stagedProvider();
  let reads = 0;
  const result = await run(original, {
    provider,
    readCurrentInput: async () => ++reads === at ? changed : original
  });
  expect(result).toMatchObject({
    state: "stale", proposal: null,
    semanticFreshnessFailure: { phase, state: "stale", reason: "seed_changed" }
  });
  expect(provider.observe).toHaveBeenCalledTimes(calls);
});
```

- [ ] 같은 표를 파일/체크 순서만 바꾼 입력에 적용한다. 두 개 이상의 서로 다른 record로 실제 순서 변화가 있었음을 확인하고, 네 fence 모두 valid/2 calls로 evidence stage까지 완료돼야 한다. provider 입력 비교는 가짜 시계로 timeout을 고정하고, 실행 시간 bucket은 동일성 비교에서 제외한다.
- [ ] null/auth/rate-limit/private/read exception을 기존 matrix와 대조한다. 확인 불가 결과가 current 또는 목표 없음으로 바뀌면 실패다. after_evidence 실패에서 claim까지 null인지 확인한다.
- [ ] service 테스트는 실제 observer→finalizer→assessment를 통과시켜 같은 결과인지 검사한다. 기본 input은 명시적 목표라 AI를 생략하므로, 기존 `semanticInput` 패턴(`title: "Maintenance notes"`, `description: "Internal cleanup only."`, taskText 비움)에 서로 다른 파일·체크 2개 이상을 넣는다. provider가 한 목표를 제안하고 아래 stage 순서를 정확히 실행한 뒤 결과를 비교해야 한다. 등록된 claim validator를 사용하고 `{ valid: true }`를 만들어 우회하지 않는다. call-count 전용 report stub은 schema 검증 증거가 아니며 실제 report 검증은 기존 route/runtime suite로 별도 확인한다.
- [ ] queued worker도 위 semanticInput 패턴을 사용한다. canonical seed로 queue한 뒤 순서만 다른 입력을 처리하고 claim/evidence 각 1회 호출을 확인한다. 다르게 결속된 pending hash는 stale/null bundle/provider0을 유지한다. 과거 해시를 변환하는 fallback을 추가하지 않는다.

```ts
expect(provider.observe.mock.calls.map(([request]) => request.stage))
  .toEqual(["claim_discovery", "evidence_linking"]);
expect(provider.observe).toHaveBeenCalledTimes(2);
```
- [ ] 현재 schema/runtime/share/store/presenter/exporter 테스트를 실행해 old summary reason 값과 서명 왕복을 보존한다. private freshnessFailure/seed/record 원문 sentinel은 기존 public/tenant/Markdown/Slack/GitHub comment/audit 경계에 없어야 한다.

```sh
pnpm exec vitest run src/lib/general-pr-observation-source.test.ts src/lib/general-pr-semantic-evidence-selection.test.ts src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-worker.test.ts src/lib/general-pr-assessment.test.ts src/lib/general-pr-assessment-presentation.test.ts src/lib/general-pr-semantic-proposal.test.ts src/app/api/analyze/route.test.ts src/lib/report-validation.test.ts src/lib/report-share.test.ts src/lib/server-report-store.test.ts src/lib/markdown.test.ts src/lib/slack.test.ts scripts/smoke-analyze-pr-url.test.mjs
```

- [ ] 전체 로컬 gate를 순차 실행한다. lint는 현재 tsc와 같으므로 별도 ESLint 결과로 보고하지 않는다.

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

- [ ] 독립 Sol은 actual diff를 확인한다: 동일 record pairing, 정렬 대상 제한, 중복 보존, 실제 변경 계속 차단, 잘못된 head 단정 제거, schema/권위/호출수 유지. supervisor가 명령 결과를 직접 확인한다.
- [ ] 아래 진행표를 채운다. 문서 완료와 구현 완료를 구분하고, 전체 테스트 통과를 AI 정확도나 출시 준비 완료로 바꾸지 않는다.
- [ ] 로컬 종료 후 사용자에게 결과를 짧게 보고한다. commit/push/deploy/live/25개 재평가는 자동 다음 단계가 아니며 요청 없이 실행하지 않는다.

## 진행 기록

| Task | 상태 | 기록할 근거 |
|---|---|---|
| 1 | 구현·focused 검증 완료 | seed+descriptor 공통 정렬; 순열/identity/duplicate/단일 변경 RED→GREEN; typecheck exit 0 |
| 2 | 구현·focused 검증 완료 | head/base/source/check truth table, `head_mismatch` 제한, legacy snapshot 문구 |
| 3 | 로컬 종료 | 4-fence/observer/service/queued worker; 최종 전체 2607 passed/2 skipped, typecheck/lint/build/diff-check exit 0; 독립 Sol 잔여 지적 없음 |

### 실제 실행 결과 (2026-09-04)

- Baseline: 5 files, 115 passed, exit 0.
- Task 1 RED: 3×3 seed/selection 순열에서 index-bound check/descriptor 차이로 2 assertions failed. GREEN: Task 1 focused 32 passed.
- Task 2 RED: head/base reason, assessment, legacy presenter assertions failed. GREEN: Task 2 focused 103 passed.
- Targeted suite: 9 files, 190 passed; compatibility-focused suite: 15 files, 442 passed; `pnpm typecheck` and `git diff --check` exit 0.
- 감독자 1차 전체 gate 보고: `pnpm test` 2583 passed/2 skipped, typecheck/lint/build exit 0. 이후 test-only 보강이 진행 중이므로 이 값은 최종 gate 근거가 아니며 감독자 재실행이 필요하다.
- 독립 검토 gap 보강: production 변경 없이 7-file focused 228 passed, typecheck/diff-check exit 0. fixed-budget 36순열 provider request, frozen/ref, null 4-fence, seed/bundle mismatch, pending hash, signed `head_mismatch` roundtrip을 보강했다. 전체 gate 재실행은 감독자 소유다.
- 후속 bounded row 보강: path/check name/requirement-source/completeness/source-order 및 seed-covered execution identity mutation, empty anchors, normal-vs-reordered service/worker equality, conflicting duplicate fileRef를 추가했다. 7-file rerun 177 passed, typecheck/diff-check exit 0. `checkEvidenceRef`는 current seed envelope에 없으므로 새 seed coverage로 주장하지 않는다.

**중단 조건:** public schema migration, 추가 provider 호출, 새로운 source freshness coverage, ownership/claim admission 변경, unrelated 실패 수정이 필요해지면 현 패키지를 확장하지 않는다. 입력 순서 원인을 해결하지 않고 재시도/timeout을 늘리는 우회도 금지한다.

**남는 미확정:** 과거 live 거절 제안의 타당성, 실제 seed 변경 항목, 목표 미채택의 의미적 원인. 이 계획의 합격 조건에 임의로 넣지 않는다.

### 최종 감독 검증

- 2026-09-04 KST, 기준 HEAD `1486d9be01ef72e0b7ad50c318459c98ea46ffbc` + 현재 working diff.
- `pnpm test`: 189 files, 2607 passed, 2 skipped, exit 0. skip은 외부 AI live opt-in 테스트 2개이며 실행하지 않았다.
- `pnpm typecheck`, `pnpm lint`(tsc), `pnpm build`, `git diff --check`: 모두 exit 0.
- 독립 Sol: A1–A10에서 지적한 누락 보완을 확인했고 최종 잔여 critical/important/minor 없음. 감독자는 제품 5개 파일 diff가 검토 후 바뀌지 않았음을 직접 비교했다.
- 구현은 Terra, 통합 검증·문서 상태 정리는 Sol. 순차 작업을 한 패키지로 묶었으며 리뷰에서 나온 보완은 테스트에만 적용했다. 새 의존성/공개 schema/AI 예산/권위 변경 없음.
- 기록은 local-only. commit/push/배포/외부 PR 재시험은 수행하지 않았다. 다음 단계는 별도 승인 후 진행한다.
