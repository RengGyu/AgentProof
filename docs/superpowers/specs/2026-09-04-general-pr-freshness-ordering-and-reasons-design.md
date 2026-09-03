# 일반 PR freshness 순서 안정화·사유 정확화 명세

**상태:** 사용자 승인 범위의 구현·로컬 검증·독립 Sol 재검토 완료. commit/push·배포·새 live 평가는 미실행이며 출시 완료를 의미하지 않는다.

**기준:** `codex/general-pr-hybrid-observation-impl`, HEAD `1486d9be01ef72e0b7ad50c318459c98ea46ffbc`, 작업 트리 `/private/tmp/agentproof-general-pr-hybrid-observation-impl`. 이전 진단 테스트와 로컬 명세/계획은 미커밋 상태이므로 HEAD만으로 진단 자료까지 재현되지는 않는다.

**계획:** [구현계획](../plans/2026-09-04-general-pr-freshness-ordering-and-reasons.md)

## 1. 목표와 범위

이미 수집한 **같은 파일·체크 목록의 순서 차이** 때문에 AI 관찰을 버리지 않고, 실제 변경 또는 확인 불가일 때는 계속 채택을 막는다. head 변경을 확인하지 못했다면 head가 변경됐다고 표시하지 않는다.

이 작업은 AI 의미 정확도 개선, Supported 승격, 일반 PR 계약 자동 승인 작업이 아니다. 기존 명세의 증거 공유 금지와 명시적 목표 AI 생략은 재현됐지만 기존 규정에 따른 동작이다. 두 규정의 변경은 별도 제품 판단이며 이번 구현에 포함하지 않는다.

### 고정 제약

- 제품은 evidence report이며 일반 코드 리뷰·merge/release gate가 아니다.
- source authority, claim admission, ownership, Supported/Contradicted ceiling은 변경하지 않는다.
- 최대 provider 호출 2회, semantic 총 budget 60초, 기본 retry·모델·프롬프트·선택 한도는 변경하지 않는다.
- 네 freshness fence와 실패 시 semantic proposal 전체 보류는 유지한다.
- 공개/저장 schema의 필드·enum·서명 payload는 추가하거나 변경하지 않는다. 과거 summary backfill은 하지 않는다.
- 토큰·원문·raw provider 응답·새 private digest를 저장하거나 공개하지 않는다.
- 새 dependency, 실행 sandbox, collector 재작성, PR별 예외를 추가하지 않는다.
- 이 문서는 구현·commit/push·배포·유료/live API 호출 승인이 아니다.

## 2. 확인된 원인과 연구 증거

| 근거 | 확인 내용 | 확인하지 못한 내용 |
|---|---|---|
| `general-pr-observation-source.ts:139–174` | 파일/체크 입력 순서를 유지하며 check/execution atom ID에도 index를 사용 | 실제 세 live freshness 실패에서 바뀐 항목 |
| `general-pr-semantic-evidence-selection.ts:254–306` 및 atom 검증 | seed와 원본 파일/체크를 index로 다시 연결 | 단순 해시 정렬만으로 안전한 연결이 된다는 주장 |
| `general-pr-semantic-observer.ts:513–523` | 전체 seed 차이를 stale/seed_changed로 처리 | seed에 없는 원문/로그까지 동일하다는 주장 |
| `general-pr-assessment.ts:74–80` | 일반 stale 또는 seed 불일치를 head_mismatch로 표시 | 실제 head drift를 독립 확인했다는 주장 |
| 기존 진단 테스트 | 순서만 바꿔 after_claim 결과 폐기 재현; 별도 stale bundle의 head 오인 사유 재현 | 실제 provider의 의미 정확도 |

2026-09-04 감독 재실행: 진단/source/observer/evidence-selection/assessment **5 files, 115 tests passed, exit 0**. 기존 동작의 확인이지 수정 완료 증거가 아니다.

별도 읽기 전용 실험: 제품 함수를 바꾸지 않고 입력 복사본의 파일·체크를 동일한 규칙으로 정렬한 뒤 seed와 selection을 생성했다. 합성 파일 3개 × 체크 3개의 **36가지 순열 모두 같은 seed와 evidence selection hash**를 만들었다. 원본 입력은 변하지 않았다. head/base/본문/check 결과/파일 제거/체크 중복 추가/본문 문장 순서 변경의 7개 대조군은 계속 다른 seed가 됐다. seed만 정렬한 입력으로 만들고 원본 순서의 입력을 연결기에 주는 대조군은 claim selection 단계에서 거절됐다.

이 실험은 공통 정렬 경계의 타당성을 뒷받침한다. 아직 제품 함수 내부에 적용하거나 네 fence/queued 경로까지 수정한 결과는 아니다. 36개는 합성 순열이지 외부 PR 36개가 아니다.

### 외부 기술 자료와 적용 판단

- [RFC 8785 §3.2.3](https://www.rfc-editor.org/rfc/rfc8785#section-3.2.3)은 객체 속성을 정렬하지만 배열 원소 순서는 보존한다. 따라서 JSON canonicalizer 교체만으로 도메인상 순서가 무의미한 목록 문제를 해결할 수 없다. 어떤 배열이 목록인지는 제품 코드가 정해야 한다. 이 구현을 JCS 준수 구현이라고 주장하지 않는다.
- [ECMAScript Array sort](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.sort)는 일관된 comparator와 안정 정렬을 정의한다. 입력 배열을 직접 정렬하지 않고 복사본과 locale 비의존 비교를 사용한다.
- [Vitest test.each](https://vitest.dev/api/test#test-each)로 동일 불변조건에 여러 순열·변경·실패 단계를 대입할 수 있다. 이미 설치된 Vitest만 사용하며 별도 property-testing 프레임워크를 추가하지 않는다.

## 3. 대안 비교와 선택

| 대안 | 장점 | 거절/선택 이유 |
|---|---|---|
| SHA만 비교하거나 seed 변화 무시 | 코드가 짧음 | source/check/completeness 변경까지 놓치므로 거절 |
| 최종 seed 배열 또는 hash serializer만 정렬 | 표면상 작은 수정 | index 기반 ID와 descriptor 원본 연결이 달라지므로 거절 |
| **공통 목록 정렬 후 기존 seed·descriptor 생성** | 기존 ID/validator/receipt 구조 유지 | **선택.** 원인인 순서 차이를 생성 경계에서 제거 |
| 별도 freshness fingerprint/새 ID 체계 | 기존 순서와 별도로 비교 가능 | 두 identity 체계와 migration이 생겨 이번 범위에는 불필요 |

## 4. F1 — 공통 목록 순서

### 인터페이스와 위치

`src/lib/general-pr-observation-source.ts`에 작은 helper 하나를 둔다.

```ts
export function canonicalizeGeneralPrObservationCollectionsV1(
  input: Pick<PullRequestInput, "changedFiles" | "checks">
): Pick<PullRequestInput, "changedFiles" | "checks">;
```

전체 입력의 새 schema나 generic normalizer를 만들지 않는다. 반환 배열만 새 배열이고 원소는 기존 record를 유지한다. 원본 배열·record·source text는 수정하지 않는다.

### 정렬 계약

1. 파일 key는 고정 tuple `[path.replace(/\\/g, "/"), previousPath ?? null, status ?? "unknown"]`의 JSON 직렬화다. 이전 경로는 현재 fileRef 계산과 같이 그대로 보존한다.
2. 체크 key는 고정 tuple `[name, status, workflowPath, workflowRef, runId, runAttempt, jobId]`다. 뒤 5개는 **현재 seed의 execution envelope에 실제 표현되는 값**과 같은 정규화다: 없는 identity는 null, path는 비어 있으면 null, workflow/run/job ID는 기존 `String(...)` 변환, runAttempt는 양의 safe integer 또는 null.
3. 고정 tuple은 primitive만 포함한다. key는 원소별 한 번 계산하고, 문자열 `<`/`>`로 -1/0/1을 반환한다. localeCompare, 원래 index를 tie-breaker로 쓰는 일, 객체의 임의 속성 순서 의존은 금지한다.
4. 같은 key는 같은 seed-covered 의미를 가진다. **중복을 제거하지 않는다.** 같은 이름의 서로 다른 run/job은 key가 달라야 한다. 같은 이름·상태의 실행 identity 없는 체크도 개수를 보존한다.
5. 파일 ref가 중복/충돌하면 기존 descriptor validator의 거절을 유지한다. 중복을 지워 valid로 만들지 않는다.
6. patch/summary/URL/log/timestamp 등 현재 seed에 포함되지 않는 값을 정렬 key에 넣지 않는다. metadata 변화 때문에 불필요한 순서 변화가 재발하지 않아야 한다.

### 연결 적용점

```text
원본 PullRequestInput (변경하지 않음)
  ├─ 공통 목록 정렬 → 기존 seed builder → canonical index → 기존 ID/hash
  └─ 같은 목록 정렬 → 기존 descriptor builder → 동일 index/원본 record 연결
                         ↓
               기존 selection/validator/receipt
```

- seed builder의 changedFiles, executions, check atoms 모두 정렬된 배열을 사용한다. check와 execution index를 따로 정렬하지 않는다.
- selector의 seed 재생성은 같은 builder를 호출한다. `buildDescriptorCatalogs`에만 같은 helper로 만든 배열을 전달하고, 기존 index 재검증은 삭제하지 않는다.
- source units, 구조화된 span, source 내부 문장, objective span IDs, 실행 parent 순서는 정렬하지 않는다. 이 순서는 의미·출처 결속에 필요하다.
- validator는 전달된 seed의 hash를 그대로 재계산해야 한다. 임의 순서의 seed 객체를 검증기 안에서 정렬해 통과시키지 않는다.
- 바뀌는 것은 동일 점수 후보의 기존 입력 순서 tie-break가 canonical 순서가 된다는 점이다. 순열끼리 selection이 같아야 하며, 이전 배포의 선택과 항상 같다고 주장하지 않는다. 점수·예산·authority는 바꾸지 않는다.

## 5. F2 — 실제 관찰된 변경 사유만 표시

### 성공적으로 재수집했을 때

기존 `readCurrentPublicSubject`에서 current seed를 한 번 만든다. 예외/null/private 분류는 그대로 유지한다.

| 조건 | 결과 |
|---|---|
| 양쪽 head가 비어 있지 않은 문자열이며 다름 | stale/head_changed |
| head 차이를 확인하지 못했고 양쪽 base가 비어 있지 않은 문자열이며 다름 | stale/base_changed |
| 그 외 전체 seed가 다름 | stale/seed_changed |
| 전체 seed가 같음 | current |

head와 base가 함께 다르면 head를 첫 사유로 보고한다. 한쪽 anchor가 null/빈 문자열이라는 사실만으로 head/base 이동을 단정하지 않는다. 기존 수집기의 anchor 검증을 완화하지 않는다. typed GitHub source-change 예외는 기존 source_changed로 남긴다. raw body나 hash를 추가로 보관하여 변경 원인을 복원하지 않는다.

### 보고서 사유

- 새 assessment의 `head_mismatch`는 `semanticFreshnessFailure.state === "stale" && reason === "head_changed"`일 때만 생성한다.
- base/source/seed 변경, seed와 bundle 불일치, 사유 없는 legacy stale은 head_mismatch를 만들지 않는다. 기존 `sourceState: ambiguous`, `source_ambiguous` 및 `links.state: unavailable`로 안전하게 보류됐음을 나타낸다. 상세 종류는 이미 있는 인증 ops 진단에서만 본다.
- 여기서 ambiguous는 원문의 요구사항이 애매하다는 확정이 아니라 **현재 snapshot에 안전하게 연결할 수 없다는 상태**다. 기존 presenter의 “could not be used safely” 의미를 유지한다.
- 공개 enum 추가 없이 거짓 head 단정을 제거한다. UI에서 base/check/source 종류별 세부 사유가 필요해지면 별도 additive schema 작업으로 승인받는다.
- legacy 저장 summary의 head_mismatch는 과거에 넓게 사용됐으므로 역으로 실제 head 변경을 추론할 수 없다. 해당 공통 문구는 `Collected evidence could not be matched to the analyzed snapshot.`으로 바꾼다. 저장된 reason 값·signature는 바꾸지 않는다.
- link counts 0, semantic proposal 전체 보류, source/contract 권위, target conclusion 및 headBound 계산은 기존 정책을 유지한다. 사유 표시 수정이 결과 재승격을 만들면 안 된다.

## 6. F3 — 유지해야 할 freshness·호환 경계

- before_claim / after_claim / before_evidence / after_evidence 네 fence는 동일한 builder와 비교를 사용한다.
- 같은 record들의 순서만 다르면 진행할 수 있다. 실제 seed-covered 값이 달라지거나 재조회 불가면 proposal은 null이며 추가 provider 호출은 중단한다.
- 실패 위치별 이미 실행한 provider 호출 수는 0 / 1 / 1 / 2다. after_evidence 실패에서도 이전 claim/관계를 재사용하지 않는다.
- 현재 입력이 다르지만 head만 같다는 이유로 통과시키지 않는다. completeness의 complete→incomplete 변경도 계속 감지한다.
- 과거 unsorted pending worker의 hash가 새 builder와 다르면 기존 stale 처리를 유지한다. hash 번역·재서명·자동 재시도·이전 응답의 새 seed 재결속을 하지 않는다. 이미 canonical 순서라 hash가 같다면 표현된 입력도 같으므로 기존 검증을 그대로 적용한다.
- seed/selection/receipt/objective hash가 달라질 수 있다. schema version은 데이터 모양을 유지하므로 그대로 두고, 비교 결과에는 candidate SHA를 기록한다. old saved summary를 새 판정의 근거로 backfill하지 않는다.
- source fingerprint의 정렬, GitHub collector 순서, 전역 stableJson, public report evidence ID에는 손대지 않는다.

### 중요한 한계

seed equality는 전체 PullRequestInput equality가 아니다. 현 seed는 patch 본문·hunk label·additions/deletions·logs·check summary/URL·일부 workflow metadata를 포함하지 않는다. 이 작업은 기존 coverage를 넓히거나 그 공백을 해결했다고 주장하지 않는다. patch의 hunk label은 descriptor가 사용하므로, helper는 원래 파일 record를 그대로 전달해야 한다. 원문 freshness coverage 확대는 별도 근거·설계가 필요하다.

## 7. 고정 수용 테스트

| ID | 테스트 | 통과 조건 |
|---|---|---|
| A1 | 파일 3개·체크 3개 순열 36개 | full seed, atom IDs, 선택 결과/hash, 고정 budget provider 입력이 모두 동일 |
| A2 | 원본 freeze·idempotence | 입력 변형 없음; 정렬을 두 번 해도 같은 값 |
| A3 | 같은 이름·상태, 다른 workflow/run/attempt/job | pairing 보존, 순열 결과 동일; identity 값 변경은 감지 |
| A4 | 정확한 중복 체크 / 중복·충돌 파일 | 개수 유지; 기존 거절이 valid로 바뀌지 않음 |
| A5 | 1필드씩 실질 변경 | head/base, source text/identity, path/previousPath/status, check name/status, seed-covered execution identity, completeness는 seed 차이 |
| A6 | 순서가 의미 있는 source/span/parent | 문장 순서·parent 순서 차이는 무시하지 않음 |
| A7 | 네 fence × 순서 변화/실질 변경/조회 불가 | 순서만 바뀐 정상 입력은 진행; 나머지는 응답 미채택과 0/1/1/2 호출 상한 유지 |
| A8 | 사유 truth table | head 직접 확인만 head_mismatch; base/source/check/legacy stale/null/auth는 head 단정 없음 |
| A9 | 실제 service→assessment + queued adapter | semantic 경로의 claim/evidence 각 1회(총 2회) 확인 후 순서 변화에 동일 결과; old mismatched pending seed는 stale; 명시적 목표 bypass나 direct helper assertion으로 대신하지 않음 |
| A10 | legacy summary·privacy·기존 규정 | decode/signature 유지, private 진단 누수 없음, ownership/AI bypass/권위·호출 budget 유지 |

Fixture는 합성 내용과 순열/단일 변경 규칙으로 만든다. 외부 PR 번호·이름·성공률을 구현 조건이나 테스트 정답으로 넣지 않는다. 제안 정확도나 25개 결과 개선율을 이 표의 통과 기준으로 사용하지 않는다.

## 8. 완료·중단·후속

로컬 완료는 A1–A10과 기존 전체 테스트/typecheck/lint/build/diff check 통과다. 테스트 통과 수뿐 아니라 실제 diff와 실패 대조군을 Sol이 확인한다. 새로운 lifecycle/DB/schema/collector 변경이 필요해지면 범위를 늘리지 말고 보고한다. 30분을 넘길 전망이면 진행 증거와 남은 일을 먼저 보고한다.

Rollback은 이 순서 안정화·사유 패치만 되돌린다. 기존 진단/관찰 기능을 없애지 않는다. 이미 저장된 payload를 수정하지 않고, 서로 다른 구현에서 만든 pending hash는 계속 불일치 시 거절한다.

배포/live 평가는 별도 승인 후 필요한 소수 사례부터 진행한다. 실제 ownership 거절 3건의 타당성, freshness 3건의 실제 변경 항목, 목표 미채택 6건의 원인은 여전히 미확정이다. 이 작업을 마쳐도 이들이 모두 해결됐다고 보고하지 않는다.

## 9. 구현 증거 기록

### 2026-09-04 로컬 구현 기록

| 구간 | 상태 | 직접 근거 |
|---|---|---|
| F1 | 구현·focused 검증 완료 | 공통 copied-list 정렬 helper를 seed와 descriptor 경계에 적용. 3×3 순열 36개, descriptor의 path/hunk token pairing, idempotence·중복 보존·duplicate fileRef 거절·covered-field 변경을 테스트함. |
| F2 | 구현·focused 검증 완료 | 재수집 seed에서 확인된 head/base 차이만 분리하고, assessment/presenter의 `head_mismatch`를 실제 `head_changed`에만 한정함. legacy 문구를 snapshot-safe 문구로 교체함. |
| F3·통합 | targeted 검증 완료 | 네 fence의 실제 check 변경은 0/1/1/2 호출로 proposal을 보류하고, 순서만 다른 2-file/2-check 입력은 observer·advisory service·queued worker에서 claim/evidence 각 1회로 완료함. |
| 전체 gate | 감독자 최종 재실행 완료 | `pnpm test`: 189 files, 2607 passed, 2 skipped; `pnpm typecheck`, `pnpm lint`, `pnpm build`, `git diff --check` 모두 exit 0. lint는 tsc이며 ESLint 검증 주장이 아니다. skip 2개는 AGENTPROOF_LLM_LIVE=1이 필요한 외부 AI 테스트다. |
| 독립 검토 | 잔여 지적 해소 | Sol이 실제 diff를 검토하고 A3/A8 및 중복·legacy·service 경계 테스트 보완을 재확인. 남은 critical/important/minor 지적 없음. 제품 코드는 최초 검토한 5개 파일 diff와 동일하다. |

**검증 범위:** A1–A10의 로컬 수용 근거를 확인했다. 36순열은 합성 입력 실험이며 실제 PR 성공률이 아니다. seed에 원래 없던 `checkEvidenceRef`·원문 등의 coverage는 확장하지 않았다. 기준 HEAD는 그대로이고 변경은 작업 트리에만 있으므로 재현 시 이 diff도 필요하다.

**명령 근거:** baseline 115/115, focused 190/190, compatibility-focused 442/442, `pnpm typecheck` exit 0, `git diff --check` exit 0. 이 결과는 fixture 기반 로컬 검증이며 AI 제안의 의미 정확도·live PR 결과·출시 준비를 증명하지 않는다.

핵심 용어: ordering(목록 순서), freshness(현재성), binding(증거 결속). `Same facts, same result.` / `A changed order is not a changed head.`

**설계 검토:** 독립 Sol의 read-only 검토에서 index 연결·중복·fence·legacy 규격의 추가 차단 문제는 발견되지 않았다. service/worker 기본 fixture가 AI bypass로 테스트를 통과할 수 있다는 지적을 A9와 Task 3에 반영하여 두 semantic stage의 실제 호출을 필수로 했다. 의미 정확성 보증으로 해석하지 않는다.
