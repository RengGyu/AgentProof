# Flask #5916 / PR #5917 — A/B와 AgentProof 비교

## 동일 입력

- Issue #5916 원문, PR #5917 설명과 정확한 base/head diff.
- A/B: 각각 `gpt-6-astra / medium`, 서로와 AgentProof 결과를 보지 않음.
- AgentProof: 현재 deterministic report + PR-to-Evidence Review 경로. CI·테스트 실행 기록 없음.

## 결과

| 항목 | A/B 공통 판단 | 현재 AgentProof |
| --- | --- | --- |
| 핵심 목표 | 전역 설정이 꺼져도 개별 인자·속성으로 자동 OPTIONS 활성화 | 생성 requirement는 `We should also consider deprecating the config` 한 개 |
| 첫 코드 | `src/flask/sansio/app.py`의 등록 로직 | `CHANGES.rst` |
| 관련 테스트 | `tests/test_basic.py`, `tests/test_views.py` | `tests/test_basic.py`는 후보에 포함, `tests/test_views.py`는 수집 변경으로만 표시 |
| 중요한 미확인 | 인자 `True` 직접 회귀 테스트가 보이지 않음 | 핵심 목표를 놓쳐 이 테스트 공백을 제시하지 못함 |
| 실행 판단 | 실행하지 않았다고 명시 | 실행 후보 0건, 성공 주장 없음 |

## 직접 관찰

- AgentProof는 linked Issue 출처와 exact-commit 링크를 유지했다.
- 관련 구현 `src/flask/sansio/app.py`와 기본 테스트 파일은 후보 안에 있었다.
- 그러나 첫 목표를 `Review goal at source offset 0`으로 표시했고, 선택 가능한 코드 후보가 넓고 잡음이 많았다.
- 선택적 제안인 설정 폐기를 유일한 생성 requirement로 올렸고, 이슈가 명시한 최소 수정 목표는 requirement로 만들지 못했다.
- 첫 확인 위치가 `CHANGES.rst`여서 A/B가 선택한 실제 등록 로직으로 바로 안내하지 못했다.
- AgentProof 자체 결론은 `unclear`였고 실행 성공이나 해결 완료를 주장하지 않았다.

## 판단

이 사례에서 증거 수집과 링크 생성은 일부 작동했지만, 사용자 가치의 병목은 목표 추출과 첫 위치 순위다. 저장소 검색 범위를 더 넓히기 전에, 확정된 최소 목표와 선택적 제안을 구분하고 변경 구현·관련 테스트를 changelog·일반 문서보다 먼저 보여주는 일반화 가능한 기준을 검증해야 한다.

이 문서는 단일 사례 진단이며 정확도나 일반 성능을 뜻하지 않는다.
