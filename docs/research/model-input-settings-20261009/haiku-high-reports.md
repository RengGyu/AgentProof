# Haiku 5.5 실제 평가 보고서

Adaptive/HIGH, 동일 frozen 3사례. 앱 제한은 합계 $1과 사례당 탐색8회+최종1회. 직접 실행, 응답 보정/재시도0. 실제 대상 저장소 테스트 명령은 실행하지 않음.

## https://github.com/expressjs/express/pull/7442

상태: failed / purpose_final_quote. 전체 31.70초, 추정 $0.0055629.

검증 실패: 직접 인용은 두 workflow 원문 모두에 존재하지만, 각 직접 인용에 ID 두 개를 붙여 계약의 단일 ID 규칙에 걸림. 허위 인용과 구분. 아래는 실패 원응답이며 정상 보고서로 수용하지 않음. base는 미수집.

```json
{
  "clauses": [
    {
      "clauseId": "pc_63d7791be684331f6598b164",
      "implementation": "supports",
      "testRelation": "relevant",
      "evidenceRefs": [
        "pe_703346b657f121f0d5a45d5a",
        "pe_ea65efc6279fb8a9a065e4ea"
      ],
      "counterEvidenceRefs": [],
      "changeObservations": [
        {
          "basis": "source_text",
          "text": "uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
          "evidenceRefs": [
            "pe_703346b657f121f0d5a45d5a",
            "pe_ea65efc6279fb8a9a065e4ea"
          ]
        },
        {
          "basis": "model_interpretation",
          "text": "In the head revision, both workflow files reference actions/setup-node at commit 820762786026740c76f36085b0efc47a31fe5020 with a comment labelled v7.0.0, which is consistent with the required update to version 7.0.0. The prior 6.4.0 reference is not visible in the supplied evidence because no base-side file was provided.",
          "evidenceRefs": [
            "pe_703346b657f121f0d5a45d5a",
            "pe_ea65efc6279fb8a9a065e4ea"
          ]
        }
      ],
      "testObservations": [
        {
          "basis": "source_text",
          "text": "run: npm run test-ci",
          "evidenceRefs": [
            "pe_703346b657f121f0d5a45d5a",
            "pe_ea65efc6279fb8a9a065e4ea"
          ]
        },
        {
          "basis": "model_interpretation",
          "text": "These are static workflow definitions: the test jobs set up Node.js with the pinned setup-node action and then run npm run test-ci. No workflow execution or pass/fail result is observed in the supplied evidence (execution not_observed), so this does not show that the updated action runs successfully.",
          "evidenceRefs": [
            "pe_703346b657f121f0d5a45d5a",
            "pe_ea65efc6279fb8a9a065e4ea"
          ]
        }
      ],
      "remainingQuestions": [
        {
          "text": "Are there other workflow or configuration files in the repository that reference actions/setup-node at a version other than 7.0.0? Localization is partial and only two workflow files were supplied.",
          "evidenceRefs": [
            "pe_703346b657f121f0d5a45d5a",
            "pe_ea65efc6279fb8a9a065e4ea"
          ]
        },
        {
          "text": "Does the base revision show the previous reference as actions/setup-node at version 6.4.0? No base-side file is in the supplied evidence.",
          "evidenceRefs": []
        },
        {
          "text": "Does the pinned commit 820762786026740c76f36085b0efc47a31fe5020 correspond to the upstream v7.0.0 release? This is only stated in the PR text, which is a source claim and not citable code evidence.",
          "evidenceRefs": []
        },
        {
          "text": "Do the workflows run successfully with the updated action? No execution or CI result is observed.",
          "evidenceRefs": []
        }
      ]
    }
  ]
}
```

## https://github.com/expressjs/express/pull/7425

상태: complete / 없음. 전체 92.72초, 추정 $0.0082123.

원문 대조: ArrayBuffer→Buffer.from→JSON fallback 회피 설명 정상. 테스트 전체에서 octet-stream/길이8/zero-filled body assertion 확인. Content-Type 유지 사례는 원문에 있지만 최종 별도 설명은 없음. base 미수집. npm test 통과는 원저자 주장으로 취급.

```json
{
  "clauses": [
    {
      "clauseId": "pc_755f05e8dd9af17fcf170754",
      "implementation": "supports",
      "testRelation": "relevant",
      "evidenceRefs": [
        "pe_5e205712620f6ceee3aed9e6",
        "pe_635c052868bb847b98dfb1ac"
      ],
      "counterEvidenceRefs": [],
      "changeObservations": [
        {
          "basis": "source_text",
          "text": "chunk instanceof ArrayBuffer || (chunk && chunk.constructor && chunk.constructor.name === 'ArrayBuffer')",
          "evidenceRefs": [
            "pe_5e205712620f6ceee3aed9e6"
          ]
        },
        {
          "basis": "source_text",
          "text": "chunk = Buffer.from(chunk);",
          "evidenceRefs": [
            "pe_5e205712620f6ceee3aed9e6"
          ]
        },
        {
          "basis": "model_interpretation",
          "text": "In the object case of res.send, the ArrayBuffer branch is checked before the return this.json(chunk) fallback, so a raw ArrayBuffer is converted to a Buffer instead of reaching res.json in the head revision shown in the read interval.",
          "evidenceRefs": [
            "pe_5e205712620f6ceee3aed9e6"
          ]
        }
      ],
      "testObservations": [
        {
          "basis": "source_text",
          "text": "describe('.send(ArrayBuffer)', function(){",
          "evidenceRefs": [
            "pe_635c052868bb847b98dfb1ac"
          ]
        },
        {
          "basis": "source_text",
          "text": "res.send(new ArrayBuffer(8))",
          "evidenceRefs": [
            "pe_635c052868bb847b98dfb1ac"
          ]
        },
        {
          "basis": "source_text",
          "text": ".expect('Content-Length', '8')",
          "evidenceRefs": [
            "pe_635c052868bb847b98dfb1ac"
          ]
        },
        {
          "basis": "model_interpretation",
          "text": "Statically, the octet-stream Content-Type, Content-Length 8, and zero-filled Buffer body assertions would not match the JSON fallthrough output, so the test is relevant to this clause; this does not establish that the test was executed or passed.",
          "evidenceRefs": [
            "pe_635c052868bb847b98dfb1ac"
          ]
        }
      ],
      "remainingQuestions": [
        {
          "text": "Whether npm test was actually run and what its result was is not established; execution is not_observed and the PR verification line is only an author claim.",
          "evidenceRefs": []
        },
        {
          "text": "Whether any test exercises the chunk.constructor.name fallback branch (objects not instanceof ArrayBuffer) is not shown in the supplied test snippets.",
          "evidenceRefs": [
            "pe_5e205712620f6ceee3aed9e6",
            "pe_635c052868bb847b98dfb1ac"
          ]
        },
        {
          "text": "Whether other code paths outside the acquired read intervals affect ArrayBuffer handling is unknown because localization searchState is partial_access.",
          "evidenceRefs": [
            "pe_5e205712620f6ceee3aed9e6"
          ]
        }
      ]
    }
  ]
}
```

## https://github.com/go-chi/chi/pull/1166

상태: complete / 없음. 전체 33.36초, 추정 $0.0056620.

원문 대조: head 테스트3파일의 alias 없는 import 확인. middleware 테스트 내용은 source와 양립. base/나머지 변경파일/package·module 선언 미획득, 따라서 alias 제거 자체와 전체 목적 달성 입증은 부족. 남은 질문에 해당 누락을 명시.

```json
{
  "clauses": [
    {
      "clauseId": "pc_b8352cd4a88d2e40ea39eb29",
      "implementation": "supports",
      "testRelation": "inadequate",
      "evidenceRefs": [
        "pe_ab921b5875b5e648babc8904",
        "pe_60958715a2803a36e049ae4d",
        "pe_f861aa85272b0984d5229e7b"
      ],
      "counterEvidenceRefs": [],
      "changeObservations": [
        {
          "basis": "source_text",
          "text": "\"github.com/go-chi/chi/v5\"",
          "evidenceRefs": [
            "pe_60958715a2803a36e049ae4d"
          ]
        },
        {
          "basis": "model_interpretation",
          "text": "In the head revision, each of the three acquired middleware test files imports github.com/go-chi/chi/v5 without an explicit alias, which is consistent with the clause only within those three files; base content and the diff were not acquired, so removal of superfluous aliases is not observed.",
          "evidenceRefs": [
            "pe_ab921b5875b5e648babc8904",
            "pe_60958715a2803a36e049ae4d",
            "pe_f861aa85272b0984d5229e7b"
          ]
        }
      ],
      "testObservations": [
        {
          "basis": "source_text",
          "text": "func TestHeartbeat(t *testing.T) {",
          "evidenceRefs": [
            "pe_f861aa85272b0984d5229e7b"
          ]
        },
        {
          "basis": "model_interpretation",
          "text": "The acquired test functions check middleware request handling, response codes, headers, and HTTP/2 wrapping; none assert import declarations or import alias style, so they do not test the static clause.",
          "evidenceRefs": [
            "pe_ab921b5875b5e648babc8904",
            "pe_60958715a2803a36e049ae4d",
            "pe_f861aa85272b0984d5229e7b"
          ]
        }
      ],
      "remainingQuestions": [
        {
          "text": "Whether the base revision contained superfluous import aliases in these files, and whether the diff removes them, has not been established from the acquired evidence.",
          "evidenceRefs": [
            "pe_ab921b5875b5e648babc8904",
            "pe_60958715a2803a36e049ae4d",
            "pe_f861aa85272b0984d5229e7b"
          ]
        },
        {
          "text": "Whether other repository files outside the three acquired test files contain superfluous import aliases remains unresolved; localization is partial and coverage covers only the acquired intervals.",
          "evidenceRefs": [
            "pe_ab921b5875b5e648babc8904",
            "pe_60958715a2803a36e049ae4d",
            "pe_f861aa85272b0984d5229e7b"
          ]
        },
        {
          "text": "Whether the clause's condition that the version does not affect this is satisfied has not been checked, because no module or go.mod evidence was acquired.",
          "evidenceRefs": []
        }
      ]
    }
  ]
}
```
