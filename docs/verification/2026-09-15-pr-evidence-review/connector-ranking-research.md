# 요구사항→코드 연결·첫 검토 순위 연구

2026-09-15 · research spike · 구현하지 않음

## 결론

**RECOMMENDATION — 구조를 보존한 source context + 표시용 요약 이전의 diff 특징 + 검증과 분리된 candidate 검색/순위를 먼저 채택한다.** 기존 Markdown parser와 로컬 문자열/식별자 처리를 재사용하고, 전체 저장소 인덱스·다언어 AST·LLM rerank는 첫 구현에서 제외한다.

현재 장애는 “관련 코드가 없다”가 아니다. 요구 추출에서 뜻이 빠지는 문제, 검색 입력에서 정보가 잘리는 문제, 낮은 신뢰의 검색 후보를 엄격한 검증 근거와 함께 버리는 문제, 후보의 입력 순서를 순위로 쓰는 문제가 겹친다. firstFiles는 이미 선택된 근거의 파생값이므로 독립 검색기가 될 수 없다. 후보를 더 많이 표시해도 fulfillment나 테스트 실행이 입증되지는 않는다.

### 조사 범위와 증거 수준

- **VERIFIED:** frozen 10개 입력을 기존 generateVerificationReportV2FromInput → advisory observation → runtime validation → buildPrEvidenceReview 경로로 메모리에서 실행했다. 10/10 validation 통과, validation fallback 0, semantic 존재 0, observation bundle objectives 0. objective별 code/test/execution 개수가 기존 artifact와 모두 일치했다. 로컬 계측의 fetch는 차단했고 호출 0이다.
- **VERIFIED:** 33개 changed files, 26 objectives, code 연결 16/26, any evidence 19/26. first-inspection hit@1 7/10, 경로 표시 8/10, 표시된 경우 precision 7/8. first-changed-file baseline 9/10. 두 입력 프로필의 기존 수치는 같다. 이번 재실행은 as-is의 연결 개수를 대조했으며 새 알고리즘이나 성능 개선을 측정하지 않았다.
- **HYPOTHESIS:** 아래 “과분할/맥락 문장” 해석은 원문을 읽은 연구자 판단이다. human gold가 아니며, 26개가 26개 독립 요구사항이라는 전제도 검증되지 않았다.
- 공식 문서·1차 논문 검색에는 일반 기술명만 사용했다. repo 원문·fixture·요구사항·diff는 웹에 전송하지 않았다. 모델/provider 호출 0. 제품·테스트·설정·fixture·gold·work-log는 수정하지 않았다.

기준: [결과 JSON](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/docs/verification/2026-09-15-pr-evidence-review/evaluation-linked-first-inspection.json), [입력](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/eval/fixtures/swebench-verified.diverse.jsonl), [잠정 reference](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/eval/fixtures/pr-evidence-review.references.json).

| 입력 SHA-256 | 값 |
| --- | --- |
| diverse | 452c12d0e0a0ed4566b49c62ee406bae610a54167f29a2cf2831a39de6b30bcb |
| synthetic | 1f8739055873a203a25caa872cf0723932427830ea3a4b354246c5e64fec9bc8 |
| reference | 33f9671de044f467ed41ad0d38a4ccc06983ef5f44f35359d24e267b24089fb2 |

## 1. 단계별 흐름과 손실 지점

| 단계 | 현재 동작 — VERIFIED | 손실/경계 |
| --- | --- | --- |
| source 선택 | canonicalSelectedSource가 taskText 우선, 없으면 PR description 선택; span role을 고르고 최대 8개 요구를 materialize | core가 하나라도 있으면 problem_context가 제외된다. 원문에 올바른 의도가 있어도 선택 결과에는 없을 수 있다. |
| 문장/구조 | 행별 normalizeSourceLine, ATX heading/inline section, 마침표 기반 sourceSpanBoundaries | strong-emphasis를 의미 구조로 다루지 못하는 사례와 e.g.에서 문장이 나뉘는 사례를 확인했다. fenced code는 요구 admission에서 제외된다. |
| query | extractKeywords가 토큰·camel/snake 조각·일부 alias를 만든 뒤 처음 12개 unique만 유지 | 앞부분 서술어가 뒤의 코드 식별자보다 먼저 예산을 사용한다. 원래 영어 단어와 코드 약어의 불일치도 남는다. |
| 파일 수집 | buildEvidenceIndexResult가 각 changed file의 path/kind/짧은 patch/위치 metadata 생성 | 입력의 관련 diff 존재와 requirement 연결 존재는 별개다. patch는 표시/보존 목적으로 500자 head/tail 요약된다. |
| 후보 검색 | buildRequirementEvidenceRelevanceIndex가 label+summary의 소문자 substring을 검색 | 검색도 500자 요약만 본다. 점수는 hit 개수, strong은 별도 meaningful 조건. task/PR description 자체의 일치도 검색 결과에 섞인다. |
| finding/proofGraph | finding refs 최대 5, graph refs 최대 8; typed/strict 근거와 targeted test 조건 적용 | 코드/테스트 relevance와 검증 가능한 관계는 다른데 review 후보가 strict 선택 결과에 의존한다. firstFiles 최대 5는 기존 refs에서 역산되며 독립 후보가 아니다. |
| semantic | projection은 semantic.requirement_evidence_relations를 합침 | 이 10건에는 semantic이 전혀 없다. 연결이 없는 원인을 LLM 실패로 표현하면 부정확하다. |
| 카드/첫 안내 | 명시 refs 합집합, code가 없을 때만 local firstFiles exact fallback; 첫 code→test→execution | source/ref 순서가 사실상 rank다. code가 있으면 firstFiles의 test 후보를 추가하지 않는 경우도 있다. 카드 존재는 연결 품질을 보증하지 않는다. |
| 저장/복원 | tenant hydrate가 proofGraph node의 ref 배열과 firstFiles를 빈 배열로 재구성 | 이 경로는 코드로 확인했다. 새 후보를 graph에만 넣으면 저장 후 보존을 기대할 수 없다. 기존 평가의 전체 파일/URL 보존만으로 objective별 관계 보존을 입증할 수 없다. |
| exact 링크 | side/path/exact SHA 조건이 맞아야 URL 생성 | 고정 입력은 PR URL/head/base SHA가 없다. 연결/순위가 개선돼도 정확한 commit 링크를 만들 수는 없다. |

코드 근거: [source 선택](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/extractors.ts:225), [span 선택](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/extractors.ts:809), [문장 경계](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/extractors.ts:1012), [키워드](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/extractors.ts:1669), [evidence 생성](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/extractors.ts:1551), [500자 요약](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/extractors.ts:1713), [검색](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/verifier.ts:412), [입력 순 정렬](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/verifier.ts:553), [graph](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/verifier.ts:1746), [tenant hydrate](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/tenant-report-validation.ts:636), [현재 projection](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/pr-evidence-review.ts), [현재 scorer](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/scripts/pr-evidence-review-evaluation.ts:233).

## 2. 26 objectives의 실제 연결 분포

표의 C는 code 연결, T는 code 없이 test만 연결, Ø는 code/test/execution 모두 없음이다. 이 표는 의미 정답 판정이 아니다.

| PR | objective별 상태 | 개수 C / any | 현재 첫 파일 |
| --- | --- | --- | --- |
| Matplotlib 14623 | req_1 Ø | 0/1 · 0/1 | 없음 |
| Seaborn 3187 | req_1,2,4,6,7,8 C; req_3,5 T | 6/8 · 8/8 | seaborn/_core/scales.py |
| Flask 5014 | req_1 C | 1/1 · 1/1 | src/flask/blueprints.py |
| Requests 5414 | req_1 Ø | 0/1 · 0/1 | 없음 |
| Xarray 4687 | req_1 T; req_2 Ø | 0/2 · 1/2 | xarray/tests/test_computation.py |
| Pylint 6386 | req_1,2,3 C | 3/3 · 3/3 | pylint/config/argument.py |
| Pytest 5631 | req_1 C | 1/1 · 1/1 | testing/python/integration.py |
| Scikit-learn 13142 | req_1,2,3 C; req_4 Ø | 3/4 · 3/4 | sklearn/mixture/base.py |
| Sphinx 7462 | req_1 C; req_2,3 Ø | 1/3 · 1/3 | sphinx/domains/python.py |
| Sympy 19783 | req_1 C; req_2 Ø | 1/2 · 1/2 | sympy/physics/quantum/dagger.py |

**무근거 objectives 7개는 Matplotlib·Requests를 포함한 총합이다.** 이 7개 모두 firstFiles=[]를 직접 확인했다. 나머지 code 미연결 3개는 Seaborn req_3/5와 Xarray req_1이며 test만 연결돼 있다.

### Matplotlib: 검색 이전에 요구의 의미가 사라짐

**VERIFIED:** 원문은 log/linear 모두 yaxis 반전을 기대하며, _base.py의 set_ylim 변경과 test_axes.py의 log 반전 assertion이 fixture에 있다. 그러나 선택된 유일한 req_1은 `**Expected outcome**`, 키워드는 expected/outcome이다. 이 문구는 core_requirement로 분류되고 본문 기대 문장은 problem_context로 분류된다. selectSpanCandidates의 core 우선 경로가 본문을 제외한다. 검색은 task ev_1만 찾고 code/test refs와 firstFiles는 모두 비어 있다.

**HYPOTHESIS:** 표제와 후속 본문을 구조적으로 함께 보존하면 실제 의도를 회복할 가능성이 있다. “expected”를 강제로 특정 파일에 연결하는 규칙으로 고치면 안 된다. 연결기만 바꾸고 선택된 문구를 그대로 두면 의미 있는 query가 생기지 않는다.

### Requests: source 선택 + 키워드 예산의 연쇄 손실

**VERIFIED:** 원문의 UnicodeError/InvalidUrl 설명과 Expected Result 내용은 problem_context로 제외된다. 선택된 req_1은 이전 논의에 이어 예외를 requests exception으로 다시 던지면 좋겠다는 긴 문장이다. 그 문장의 마지막 requests/exception조차 12개 키워드 예산 밖으로 밀린다. 실제 키워드는 see, there, was, some, hesitation, fixing, similar, issue, 4168, would, like, even이다. code/test 검색 일치 0; task/description refs만 남는다.

**VERIFIED:** fixture의 models.py에는 dot-leading host 처리 변경이, test_requests.py에는 InvalidURL과 dot-leading URL이 있다. 다만 models.py의 짧은 diff에는 예외 이름 자체가 없으므로 keyword 예산만 늘려도 정확한 code 연결이 해결된다고 단정할 수 없다. source의 명시 path·코드 문맥·테스트 후보가 보조 anchor가 될 수 있다. 과거 blob URL은 출처 힌트일 뿐 현재 exact-head 링크가 아니다.

### Pylint: 후보 누락이 아니라 순위 손실

**VERIFIED:** req_1 검색에서 argument.py=1, arguments_manager.py=2, utils.py=3, base_options.py=1 hit, test_config.py=2 hit다. 반환은 점수 순이 아니라 evidenceIndex 순이다. proofGraph와 projection은 이 순서를 이어받아 argument.py를 먼저 보여준다. utils.py의 -v 등록/단일 하이픈 전처리 변경과 test_short_verbose는 이미 수집됐다.

reference의 허용 첫 파일은 utils.py 또는 test_config.py이므로 현재 top1은 miss다. 그러나 req_2가 도움말 metavar도 언급하므로 argument.py를 완전 무관한 파일이라고 판정할 수는 없다. **HYPOTHESIS:** 파일명 공통어보다 변경 줄/식별자의 구체성을 우선하는 rank가 더 유용할 수 있다. 현재 hit 개수로 정렬하면 나아진다는 실험은 하지 않았고 개선 수치도 예측하지 않는다.

### 나머지 무근거 5개와 과분할 의심

| objective | VERIFIED 손실 | 의미 해석 — HYPOTHESIS |
| --- | --- | --- |
| Xarray req_2 | e.g.에서 문장이 끊겨 뒤의 apply_ufunc/keep_attrs가 떨어지고 후속 fragment는 제외된다. 실제 diff의 attributes가 500자 요약 중간에서 사라짐도 확인했다. | 원문에 attrs 보존이라는 실질 요구가 있어 진짜 연결 누락으로 조사할 가치가 높다. 구조·query·patch 세 단계 모두 관련된다. |
| Scikit-learn req_4 | `No exceptions`만 독립 query; matches/refs/firstFiles 모두 0 | 예외가 없다는 기대는 상위 predict 일관성 실행 맥락에 의존한다. 독립 code mapping을 강제하기보다 그룹 맥락/실행 기대와 구분해야 한다. |
| Sphinx req_2 | `**Describe the bug**`만 선택, task ref만 남음 | 요구보다 섹션 표제일 가능성이 높다. |
| Sphinx req_3 | `**To Reproduce**`만 선택, task ref만 남음 | 재현 섹션 표제일 가능성이 높다. |
| Sympy req_2 | “mailing list … does not work” 문장 선택, task/description만 일치; fenced 예제는 admission에서 제외 | 독립 행동 요구보다 req_1의 재현 문맥에 가깝다. 예제 symbol을 context로 활용할 수 있어도 새 요구로 승격하면 안 된다. |

Seaborn 8개에는 title, 증상, 재현 안내, 원인 추측, rcParams가 섞이고 Scikit-learn req_1/2는 같은 행동의 title/body에 가깝다. 이는 과분할 가능성이며 자동 병합 정답은 아니다. 원문 span/group를 보존해 별도 의미 검토가 필요하다. 원래 목표 수를 줄여 coverage만 높이는 평가는 금지한다.

성공 지표도 주의한다. Xarray의 첫 경로는 정상 기대 본문이 아니라 표제 req_1의 expected 키워드가 test의 expected 변수와 겹쳐 나온다. Pytest의 testing/python/integration.py는 현재 경로 regex에 의해 test가 아닌 diff로 분류돼 code 수에 포함된다. 따라서 7/10 hit나 16/26 code가 모두 올바른 의미 연결이라고 해석할 수 없다. [test 분류](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/extractors.ts:1745).

## 3. 가능한 접근 비교

아래 비용·정확성 평가는 설계 판단이며 벤치마크 결과가 아니다.

| 접근 | 비용·정확성 역할 | 언어 지원 | privacy / 운영 복잡도 | 판단 |
| --- | --- | --- | --- | --- |
| A. bounded source/diff 특징의 로컬 후보 검색 + 명시 rank | 기존 입력 한 번 스캔. 의미적 동의어/간접 호출은 약하지만 각 hit 근거 설명 가능. source 손실도 먼저 다룸 | path·식별자·hunk·문자열은 공통; 기존 JS/TS parser 신호만 선택 활용, Python 등은 lexical임을 명시 | 외부 호출/영구 repo index 없음. 파생 token/hash/offset/ID만 최소 보존. 가장 작은 운영 범위 | **첫 채택안** |
| B. 언어별 AST + import/call 그래프 확장 | 해석 가능한 구조 edge를 추가하나 동적 dispatch·부분 patch·외부 의존은 미해결. 전체 snapshot 없이 정확한 call graph 주장 불가 | JS/TS부터 가능; Python/Go 등 grammar·binding 처리가 추가됨 | 원본 snapshot 처리/캐시·parser version·언어별 실패/자원 상한 필요 | A의 구조 신호 결손이 별도 평가로 확인될 때 확장 |
| C. A 후보에 제한적 LLM rerank | 자연어/코드 표현 차이를 다룰 가능성. 누락 후보를 rank만으로 복구하지 못하고 오판/비결정성이 남음 | 모델 언어 능력 의존; 검증된 지원 범위로 표시 | 승인된 최소 packet, call/token/time 상한, 모델/version 기록, timeout fallback 필요. 원문 전송 승인 필요 | 초기엔 끔. 별도 동의와 untouched 평가로만 선택 |

기술 근거와 범위: [CodeSearchNet 1차 논문](https://arxiv.org/abs/1909.09436)은 자연어와 코드 표현의 간극을 다루는 검색 문제와 expert relevance 평가를 설명한다. 이 논문의 성능을 AgentProof PR 검증 성능으로 옮겨 주장하지 않는다. [Tree-sitter 공식 query 문서](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html)는 syntax node/field/capture와 ERROR/MISSING을 제공한다. 그 자체가 의미적 call resolution은 아니다. [TypeScript 공식 compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)는 AST 탐색과 type checker 활용을 제공하며, repo에도 [JS/TS 분석기](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/js-ts-static-test-relation.ts)가 있다. 정확한 dependency resolution은 추가 입력과 범위가 필요하다.

## 4. 권장 최소 데이터 흐름

**RECOMMENDATION — 기존 strict 결과를 바꾸지 않는 review 전용 관계 경로를 하나 둔다.** 별도 서비스·vector DB·범용 graph framework는 만들지 않는다.

1. **Source 단위 보존:** 기존 [Markdown 구조 parser](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/general-pr-structure.ts:63)의 offset/hash 패턴을 재사용한다. 문단·목록·인라인 코드·heading과 후속 body를 유지하고, e.g./코드 내부 문장부호로 자르지 않는다. 독립 bold 문단은 항상 표제라고 가정하지 않는다. 실제 bold 요구를 보존하는 반례가 필요하다. grouping 정보는 query context용이며 approval/의무 추가의 근거가 아니다.
2. **Query 만들기:** 기존 objective ID/source binding에 그 objective의 같은 구조 단위에서 확인된 path·identifier·literal·서술어를 붙인다. 짧은 자연어 budget과 identifier budget을 분리해 앞쪽 서술어가 뒤 식별자를 밀어내지 않게 한다. title/인접 문장은 실제 group/offset 관계가 있을 때만 context로 사용한다. PR 전체 문장을 모든 objective에 복제하지 않는다.
3. **파일 특징 추출:** 현재 bounded changedFiles.patch에서 표시용 compactPatchExcerpt 이전에 path/이전 path, hunk symbol, added/removed line의 identifier/literal·한정된 token을 뽑는다. 원본을 더 저장하는 것이 아니다. 각 특징에 evidence ID, side, 입력 hash, source offset 또는 확인 가능한 line, parser/feature version과 truncation 상태를 둔다. hunk context symbol과 실제 추가된 함수명을 구분한다.
4. **Recall용 후보 union:** exact path/symbol anchor, 구체적 changed-token 일치, 기존 explicit refs, 이미 확인된 test import 관계를 별도 basis로 합친다. 전역 changed files는 후보 inventory일 뿐 모든 objective의 링크가 아니다. 일반 공통어 하나만 일치하면 낮은 신뢰/표시 보류가 가능해야 한다. file/test 후보를 strict proof 선택 이전에 유지한다. 동일 파일에 대한 검색 hit 중복은 provenance를 합친다.
5. **Precision용 순위:** 같은 relation 등급 안에서 source의 명시 anchor 일치, 변경부의 구체적 feature 일치, 여러 독립 feature 일치, 파일명 일반어 순으로 설명 가능한 정렬을 한다. 긴 파일의 hit 수와 반복 token을 그대로 가산하지 않는다. 동점은 stable evidence identity/path로만 해소한다. code/test/execution 별 리스트에서 순위를 정한 뒤 첫 안내 규칙을 적용한다. parser/call edge가 없으면 없는 것으로 둔다.
6. **Projection/저장:** 연결 없음과 collected changes를 분리해서 계속 표시한다. strict requirement.evidenceRefs/proofAxes에 검색 후보를 끼워 넣지 않는다. 저장해야 한다면 optional versioned reviewLinks companion에 requirementId/evidenceId/basis·feature hash/side/rank 근거만 allowlist하고 기존 reader는 무시할 수 있게 한다. raw source, token, 임의 LLM 문장을 저장하지 않는다. tenant hydration과 copy/export의 objective별 관계 보존을 별도 검사한다. legacy report에는 companion이 없으면 기존 결과만 보여준다.

Source 구조 수정은 기존 canonical ID/source binding에 영향을 줄 수 있다. 저장된 보고서를 재번호화하지 말고 새 실행에서 extractor version과 source span 기반 대응을 기록한다. **첫 구현은 (a) 구조/context 회복과 (b) review-only 후보/순위 경로를 분리된 체크포인트로 검증**한다. classifier를 전면 교체하거나 artifact 26개에 맞춰 새 규칙을 넣는 것은 추천하지 않는다.

### 역할과 신뢰 등급

| 신호 | 후보/순위 역할 | 표현 가능한 신뢰 |
| --- | --- | --- |
| path/symbol/diff token의 exact 일치 | 후보 생성, 구체적 일치 우선 | 일치는 deterministic observed fact; 요구 구현 관계는 candidate |
| test 파일·test symbol·test와 코드의 확인된 import/call | candidate 확장/순위 보조 | 파일 존재 ≠ 테스트 실행. import 관찰 ≠ 행동 검증 |
| 완전한 입력에서 기존 validator를 통과한 관계 receipt | 기존 verified 관계 그대로 유지 | receipt가 증명하는 좁은 관계만 verified; 전체 요구 fulfilled 아님 |
| LLM rerank/semantic proposal | 이미 존재하는 evidence ID의 순서·후보 설명만 | 항상 candidate, output ID allowlist/timeout/비용 상한; observed/verified/fulfilled 승격 금지 |
| 연결 없음 | 명시 abstention | unclear/unconfirmed; 추가 파일로 채워서 coverage를 꾸미지 않음 |

## 5. 예상 수정 모듈 — 다음 작업의 범위 제안

- **extractors.ts:** 구조·query context의 손실을 방지하고 compact 전 특징을 만든다. 기존 표시용 summary 및 privacy utility는 유지한다. general-pr-structure의 parser를 재사용할 수 있으나 strict observer admission은 별도다.
- **verifier.ts의 report assembly / pr-evidence-review.ts:** strict 판단 함수를 바꾸지 않고 candidate feature/refs의 review projection 입력을 전달·정렬한다. 기존 firstFiles fallback은 legacy 호환 경로로 남긴다.
- **evidence-relation.ts / js-ts-static-test-relation.ts:** 이미 검증된 bounded import/call 관찰만 재사용한다. Python substring을 resolved import로 선언하지 않는다. [현재 exact test 연결](/Users/jeonggyuju/Project_folder/AgentProof/.worktrees/agentproof-recovery-20260913/src/lib/verifier.ts:2468)은 하나의 implementation path와 직접 import 조건을 요구한다. 이 조건을 완화해 proof로 만드는 대신 낮은 신뢰의 review 후보를 따로 유지한다.
- **types/validation/tenant storage/export:** optional review companion을 도입하는 경우에만 additive contract/allowlist 변경이 필요하다. 이것은 이번 연구에서 수행하지 않았고 별도 구현 승인 범위다. graph에만 후보를 넣고 저장될 것이라 가정하면 안 된다.
- **ReportView / Dashboard / Markdown / 관련 평가:** 동일 review projection/첫 안내, source별 basis와 abstention을 보여준다. no-issue requirements=0 change summary와 typed-contract 기존 UI/strict 결과를 보존한다.

## 6. TDD와 오프라인 평가 계획

### RED부터 필요한 테스트

1. 같은 내용의 ATX heading/bold label/본문/list 변형, 실제 bold 요구 반례, e.g.·backtick·괄호·fenced reproduction이 요구 의미/offset을 훼손하지 않는지.
2. 긴 앞부분 설명 뒤 path/symbol이 검색 budget에서 사라지지 않는지; irrelevant 앞문장 추가가 후보를 뒤집지 않는지.
3. compact 표시 중간에 있는 식별자는 파생 feature에 남고 raw 원문은 export/storage에 남지 않는지; cap/불완전 입력 상태가 명시되는지.
4. exact ref 우선, explicit candidate/test 후보와 verified receipt의 분리, 한 글자/common-token/substring collision, 중복 파일·test 이름 반례.
5. 같은 입력의 파일 순서 변경 시 동일 top1; 더 긴 무관한 파일이 hit 수로 이기지 않는지; 후보가 없는 경우 abstain; global priority가 local link로 변하지 않는지.
6. 실제 사용 가능한 snapshot에서만 import/call 관찰; unsupported language/partial hunk는 degraded candidate. base/head/rename/line와 stale SHA, legacy·tenant round trip의 관계 ID/basis/rank 보존.
7. assessment 6상태 불변, strict outcomes/receipt 결과 불변, zero-requirement 중립, portable summary/JSON reader 호환, secret redaction. LLM 단계는 별도 승인 전 테스트 double로만 실패·ID 탈출·budget/fallback 검사.

### 단계별 지표를 분리한다

- **source 품질:** 사람이 확인한 원문 의무의 보존, label-only/맥락-only objective 비율, group fragmentation; 기존 26개 개수와 새 의미 단위 수를 따로 보고한다.
- **수집:** expected files/patch/features 수집률과 truncation/unsupported 입력률. 수집률을 relevance로 부르지 않는다.
- **후보 recall:** 독립적으로 주석한 requirement→evidence 관계에 대한 recall@k, 제시율/abstention, 평균·상위 candidate 수. 기존 first-file reference는 이 관계 gold를 제공하지 않는다.
- **순위 precision:** candidate recall과 별도로 top1/precision@k·MRR 또는 nDCG, miss/미제시 모두 분모에 포함. 첫 objective와 전체 화면의 첫 파일 추천을 각각 측정한다. 현재 scorer는 모든 objective를 순회해 처음 발견한 path를 고르므로 첫 카드가 연결됐다는 지표가 아니다.
- **exact navigation:** 유효 SHA가 있는 별도 fixture에서 올바른 head/base/file/line 비율, 거짓 링크 0. 현재 10건은 이 지표의 성공 증거가 될 수 없다.
- **운영:** full/tenant/dashboard/Markdown 관계 보존, byte/feature 상한, CPU/memory/p50/p95, provider calls·전송량. human 검토 시간은 실제 사용자 실험 전 null로 둔다.

### 채택·중단 기준

**제안 기준이며 향상 예측이 아니다.** 구현 전에 k·feature/시간 예산·negative 샘플·지원 언어와 reference를 동결한다. 고정 10건은 regression/debug 세트로만 사용하고, 서로 다른 저장소/표현/무요구 PR을 포함한 untouched 세트와 독립 human 관계 라벨로 채택을 결정한다.

- security/privacy·JSON/tenant 호환·typed-contract·false execution/fulfillment promotion·false exact URL 회귀는 하나라도 있으면 중단한다.
- A는 provider 0, 고정 입력 결정성, 사전 설정 자원 상한 안에서만 채택 가능하다.
- baseline 대비 candidate recall을 유지/개선하면서 top1을 악화시키지 않는지, 작은 표본의 불확실성과 사례별 회귀까지 보고한다. 제시율 증가만으로 채택하지 않는다. 독립 표본이 부족하면 “채택 근거 부족”으로 멈춘다.
- B는 A의 남은 misses가 실제 언어 구조 정보 부재에 기인할 때만 검토한다. C는 candidate pool recall이 충분한데 semantic rank 오류가 남고, 별도 승인/비용 예산/untouched paired 평가가 있을 때만 진행한다.
- 가설을 실측하기 전 예상 hit 개선률·개발 일수·요금 수치를 쓰지 않는다.

## 7. 예상 해결 범위와 한계

**RECOMMENDATION:** 구조/context 보존은 Matplotlib류의 label/body 분리, 문장 경계·query budget·compact 전 특징은 Requests/Xarray류의 입력 손실, 독립 candidate rank는 Pylint류의 입력 순서 의존을 겨냥한다. 이는 문제 유형의 대응표이며 이 사례가 모두 해결된다는 약속이 아니다.

**UNCLEAR:** 자연어 동의어, 생략된 상위 목표, 동적 호출, 변경되지 않은 코드, 불완전 patch, 입력에 없는 실행 증거는 작은 로컬 연결기만으로 해결되지 않을 수 있다. 의미상 별도 요구인지부터 불확실한 항목은 연결 미확인으로 남긴다. 전체 저장소나 모델을 도입해도 requirement fulfillment를 자동 입증하지 못한다.

연구 완료: 기존 경로 계측/코드와 입력 대조/공식 자료 검토만 수행했다. 새 연결기·순위·성능 실험은 구현하지 않았다. 유일한 새 파일은 이 문서다.
