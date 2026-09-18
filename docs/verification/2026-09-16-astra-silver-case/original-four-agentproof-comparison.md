# 기존 4개 PR — Astra A/B와 AgentProof 비교

## 범위와 해석

- 대상: Flask #5917, Django #21900, Svelte #18752, FastAPI #16205.
- Flask 결과는 같은 날 완료한 비교를 재사용했다.
- 나머지 3개는 서로 격리된 `gpt-6-astra / medium` A/B가 PR 제목·본문과 exact base/head patch만 읽었다.
- A/B는 세 사례 모두 핵심 목표와 우선 확인 위치에서 실질적으로 일치해 C 판정은 실행하지 않았다.
- 아래 수치는 human gold 정확도가 아니라 A/B silver 판단과 현재 제품 출력의 일치 관찰이다.

## 사례별 결과

| PR | A/B가 잡은 검토 목표 | 현재 AgentProof | 첫 확인 위치 비교 | 판단 |
| --- | --- | --- | --- | --- |
| Flask #5917 | 전역 설정이 꺼져도 개별 인자·속성으로 자동 OPTIONS 활성화 | 선택적 config 폐기 제안을 유일한 requirement로 생성 | A/B `src/flask/sansio/app.py`; 제품 `CHANGES.rst` | 목표와 우선순위 모두 불일치. 관련 구현·일부 테스트 후보는 수집됨 |
| Django #21900 | `sessionStorage` 저장 전 탐색으로 생기는 Playwright flakiness 완화 | requirement 0개, change-summary만 표시 | A/B와 변경 파일 모두 `tests/admin_changelist/tests.py`; 제품은 구체적 first target 없음 | 목표는 누락. 필요한 파일은 수집했지만 왜 봐야 하는지 안내하지 못함 |
| Svelte #18752 | esrap 버그 수정분과 devalue 취약점 보고 해소를 위한 패키지 갱신 | PR 작성자 claim 1개로 보존 | 양쪽 모두 `packages/svelte/package.json`을 우선 위치로 포함 | 이번 묶음에서 가장 잘 맞음. AST·타입 변경 중 일부는 연결, 일부는 별도 변경으로 남음 |
| FastAPI #16205 | 오래된 프랑스어 번역 갱신과 기술 의미·링크·구조 확인 | 번역 갱신 목표 1개로 보존 | A/B는 대규모 축약·새 명령이 있는 문서 우선; 제품은 `docs/fr/docs/how-to/extending-openapi.md` | 목표는 맞지만 61개 파일 중 우선순위가 설명 가능한 위험 기준보다 lexical 후보 순서에 가까움 |

## 직접 관찰된 공통 패턴

1. **증거 수집은 목표 추출보다 안정적이었다.** 네 사례 모두 실제 관련 변경 파일은 제품 출력 어딘가에 남았다. 하지만 이것만으로 reviewer가 바로 핵심 판단 위치에 도달하는 것은 아니다.
2. **검토 목표는 4개 중 2개에서 A/B와 실질적으로 맞았다.** Svelte와 FastAPI는 목적을 보존했고, Flask는 선택적 제안을 목표로 올렸으며 Django는 목표를 만들지 못했다.
3. **첫 확인 위치는 4개 중 Svelte 한 사례만 A/B와 명확히 맞았다.** Django는 경로는 수집했지만 구체적 안내가 없었고, Flask와 FastAPI는 우선순위가 빗나갔다.
4. **실행 근거는 입력에 없었고 제품도 성공으로 승격하지 않았다.** 이는 올바른 보수적 동작이다.
5. **파일을 전부 표시하는 coverage와 유용한 순위는 다르다.** FastAPI는 61개 변경 파일을 모두 표시했지만, 그 사실이 우선 확인 위치의 유용성을 보장하지 않았다.
6. **저장 후 복원 검사는 별도 확인이 필요하다.** 세 사례 모두 저장 보고서 decode와 코드 링크 보존은 성공했지만, Svelte와 FastAPI는 표시 경로 배열의 순서 포함 동일성 검사가 실패했다. 이번 비교만으로 경로 누락인지 순서 변화인지 확정하지 않았다.

## 현재 결론

현재 제품의 주된 부족점은 저장소 파일을 못 모으는 것이 아니라 다음 두 단계다.

- PR 설명에서 핵심 목표·작성자 주장·선택적 제안·템플릿을 구분하는 단계
- 목표와 연결된 후보 중 reviewer가 먼저 볼 위치를 의미와 변경 위험으로 정렬하는 단계

따라서 다음 개선은 저장소 검색량 확대보다 **목표 보존**과 **first-inspection ranking**에 집중하는 편이 타당하다. 다만 이 4개는 개발 사례이고 A/B도 silver evaluator이므로 일반 정확도나 제품 성능 인증으로 해석하지 않는다.

## 실행 검증

- 3개 신규 사례 모두 current report generation, runtime validation, 저장 보고서 decode, SSR projection을 통과했다.
- 코드 링크는 저장 후에도 보존됐다. 표시 경로 배열 동일성은 Django만 통과했고 Svelte·FastAPI는 실패했다.
- 외부 테스트·CI 실행 기록은 공급하지 않았다.
- 임시 평가 probe는 실행 후 제거했다.
