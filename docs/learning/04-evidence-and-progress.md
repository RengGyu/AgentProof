# 근거 안내 · 면접 · 학습 기록

## 자료의 신뢰 수준

- **직접 확인:** 자료 작성 시 읽은 소스/파일, 저장 응답의 내용.
- **기록상 보고:** 예전 문서에 기록된 테스트/실험 결과. 이번에 재실행한 것이 아님.
- **해석/가설:** 왜 그 선택이 일어났고 무엇이 원인일지에 대한 판단.
- **미확인:** 전체 브랜치 통합 상태, 미실행 실험, 일반 정확도, 실제 사용자 시간 절감.

자료 작성 범위는 선택된 과거 문서와 현재 대화·소스·결과다. 모든 이전 대화와 브랜치를 전수 복원한 자료는 아니다. 기록이 없는 동기나 사용자 기여는 만들어내지 않는다.

## 출처 색인

아래 경로는 AgentProof 저장소 루트 기준이다. 웹 ChatGPT가 로컬 경로를 직접 열 수 있다고 가정하지 않는다. 본문에 핵심 내용이 포함돼 있어 기본 수업은 이 네 파일만으로 가능하다.

| 키 | 원본 위치 | 상태/쓰임 |
|---|---|---|
| E1 | `docs/superpowers/specs/2026-08-13-verification-contract-v2-design.md` | Proposed 문서. objective/contract/evidence 분리의 당시 근거 |
| E2 | `docs/superpowers/specs/2026-08-18-subject-bound-test-binding-correction-design.md` | 문서 자체는 locally implemented/verified로 기록. 대상 binding 사례 |
| E3 | `docs/superpowers/specs/2026-09-02-general-pr-semantic-observer-reliability-design.md` | 당시 승인 설계. duplicated role/group 계약과 시간 예산 |
| E4 | `docs/work-log.md`의 9/14 B/C 비교 및 9/15 PR-to-Evidence/assessment-independent 항목 | 시기별 보고이며 서로 다른 평가 분모를 합치지 않음 |
| E5 | `src/lib/review-intent.ts`, `src/lib/review-snippets.ts`, `src/lib/gemini-navigation.ts`, `src/app/api/analyze/route.ts` | 9/21 로컬 작업 상태. 일부 미커밋 |
| E6 | `docs/verification/2026-09-20-accuracy-10/accuracy-review.md`, `authenticated/results.json` 및 사례별 JSON | 감독 감사. 독립 A/B 합의 아님 |
| E7 | `docs/verification/2026-09-19-gemini-context-retest/comparison.json` | 기존 Flask/Starlette 반복 비교 기준 |
| E8 | `docs/astra-silver-labeler.md` | A/B source-first 블라인드 라벨링 규약. 규약 존재가 실행 완료 증거는 아님 |
| E9 | `package.json` | 사용 도구와 스크립트. dependency 존재만으로 모든 경로 사용을 뜻하지 않음 |

GitHub 저장소: https://github.com/RengGyu/AgentProof

접근 권한이 없거나 로컬 변경이 아직 원격에 없으면 웹 채팅이 내용을 확인할 수 없다. 기준 HEAD는 `639cba137dc96652c5abd052ee4a1d187429acda`이나 최신 미커밋 변경까지 나타내지는 않는다. 코드 원본이 필요하면 담당자가 해당 버전의 필요한 부분만 제공한다. 링크만 보고 모델이 읽었다고 가정하지 않는다.

브랜치 지도 확장이 필요할 때 요청할 항목: 기준 commit, 비교 commit, 변경 목적, 실제 diff, 관련 테스트, 통합/배포 여부. branch 이름이나 문서 날짜만으로 연결 관계를 확정하지 않는다.

## 최신 결과를 면접에서 잘못 말하지 않기

9/20 authenticated 10개에서 9개는 목표가 있었고 Express는 목표 없는 별도 사례였다. 감독 판단으로 핵심 목표 보존 9/9, 유용한 첫 진입 위치 8/9였으며 HTTPX는 진입 위치는 유용하나 핵심 분기가 조각 밖이었다. 98개 코드 참조의 경로·범위·해시는 맞았지만 Svelte의 의미 설명은 잘못됐다.

이는 작은 편의 표본의 감독 판단이다. ‘정확도 89% 제품’, ‘A/B 검증 완료’, ‘사람보다 정확’, ‘새 저장소에서도 일반화’, ‘검토 시간 단축 입증’이라고 표현하지 않는다. 두 기존 PR은 지난 실행과 첫 위치가 동일했다. 새로운 8개 PR은 이전 Luna 집합과 달라 모델 우열을 계산할 수 없다.

## 면접 답변 골격

“문제는 __였다. 처음에는 __로 접근했지만 __라는 한계를 관찰했다. 그래서 __와 __를 분리했다. 내가 직접 담당한 부분은 __이고, AI가 구현한 부분은 __이다. __로 확인했지만 __까지 증명한 것은 아니다. 다음에는 __를 고정하고 __만 바꾸어 검증하려 한다.”

교사는 빈칸을 임의로 채우지 말고 사용자에게 확인한다. 기술 면접은 화려한 기술 목록보다 선택·근거·한계를 설명하는 연습으로 진행한다.

대표 후속 질문:

- 왜 deterministic 처리만으로 해결하지 않았는가?
- LLM 응답 schema가 맞는데도 왜 잘못된 결과가 나오는가?
- AST와 symbol resolution의 차이는 무엇인가?
- 같은 결과를 재현하려면 코드 외에 무엇을 고정해야 하는가?
- 실패한 사례를 고치는 것과 일반화 가능한 수정은 어떻게 구분하는가?
- 출처 검증을 유지하면서 과도한 표시 차단은 어떻게 줄일 수 있는가?

## 학습 기록 템플릿

```text
날짜 / 공부한 사례:
내가 도움 없이 설명할 수 있는 것:
내가 실제로 한 설명(2~4문장):
교정받은 오해:
아직 혼자 설명하지 못하는 것:
확인한 근거 / 미확인 질문:
다음 수업 하나:
Codex에 요청할 자료(필요할 때만):
```

학습 기록에는 ‘읽었다’보다 ‘설명해 보니 어떤 부분에서 막혔다’를 남긴다. Codex에 돌아올 때 전체 수업 대화를 붙이지 않아도 이 기록으로 다음 자료를 선택할 수 있다.

## 이번 묶음 이후 확장 후보

현재 우선순위는 전체 흐름 → 사례1/3/6/7 → 평가/운영이다. 실제 숙련도에 따라 바꾼다. 이후 저장·서명·tenant 경계, webhook, 캐시 무효화, 비동기 worker, 배포 rollback을 공부하려면 해당 구현을 다시 확인한 별도 자료가 필요하다. 이 묶음에서 그 영역을 전부 검증했다고 주장하지 않는다.

자료에 키·토큰·개인정보·대량 코드 원문은 넣지 않았다. 추가 원본을 웹 채팅에 전달할 때도 필요한 범위와 공유 권한을 먼저 확인한다.
