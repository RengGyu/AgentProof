import { describe, expect, it } from "vitest";
import {
  deriveDeterministicRequirementRelations,
  extractRequirementEvidence,
  extractRequirementSpanSeed,
  selectCanonicalRequirements,
  toReportRequirements
} from "./extractors";

describe("ordinary requirement source hygiene", () => {
  it.each(["task", "issue", "pr_description"] as const)("excludes pure process and execution prose from %s before capping", (source) => {
    const text = [
      "[![Build status](https://example.test/build.svg)](https://example.test/build)",
      "You can trigger a rebase by commenting `@update-bot rebase`.",
      "To retry the bot, comment `@update-bot retry` on this PR.",
      "@update-bot rebase",
      "Ran pnpm test successfully.",
      "All 42 tests passed successfully.",
      "Verified with npm run build.",
      "Tested locally with pytest.",
      "## Validation",
      "- [x] `pnpm typecheck` passed.",
      "- npm test",
      "- Tests passed successfully.",
      "- Build completed successfully.",
      "- Add retry handling for expired sessions."
    ].join("\n");
    const input = source === "pr_description"
      ? { taskText: "", description: text }
      : { taskText: text, description: "Add an unrelated PR objective.", taskSource: source };
    const canonical = selectCanonicalRequirements({ kind: "selected_source", input });
    expect(toReportRequirements(canonical).map((item) => item.text)).toEqual(["Add retry handling for expired sessions"]);
    const extracted = extractRequirementSpanSeed(input.taskText, input.description, source === "pr_description" ? "task" : source);
    expect(extracted.overflow).toBe(false);
    expect(extracted.seed?.spans.map((span) => span.text)).toEqual(["- Add retry handling for expired sessions."]);
    expect(extracted.seed?.spans[0]).toMatchObject({
      start: text.indexOf("- Add retry"), end: text.length,
      authority: source === "pr_description" ? "pr_author_claim" : "authoritative"
    });
    expect(extractRequirementEvidence(input.taskText, input.description, source === "pr_description" ? "task" : source).omittedRequirementCount).toBe(0);
  });

  it.each(["", "## Tests\n", "## Testing\n", "Verification: ", "## Validation\n"])("preserves substantive objectives under %j", (heading) => {
    const objectives = [
      "Add regression tests for session expiry.",
      "The bot must reject rebase commands from unauthorized users.",
      "Show build status badges in the repository view.",
      "Ensure `pnpm test` returns a nonzero exit code on failures.",
      "Ran pnpm test and added retry handling for expired sessions."
    ];
    for (const objective of objectives) {
      const text = heading + objective;
      for (const source of ["issue", "pr_description"] as const) {
        const input = source === "issue" ? { taskText: text, description: "", taskSource: source } : { taskText: "", description: text };
        expect(toReportRequirements(selectCanonicalRequirements({ kind: "selected_source", input })).map((item) => item.text)).toEqual([objective.slice(0, -1)]);
        const spans = extractRequirementSpanSeed(input.taskText, input.description, "issue").seed?.spans ?? [];
        expect(spans.map((span) => span.text)).toEqual([objective]);
        expect(spans.every((span) => text.slice(span.start, span.end) === span.text)).toBe(true);
      }
    }
  });

  it.each([
    "All 42 unit tests passed.",
    "All 17 integration tests passed.",
    "Tests: 18 passed, 0 failed.",
    "Unit tests: 23 passed, 1 failed.",
    "테스트를 실행했고 모두 통과했습니다.",
    "통합 테스트를 실행했고 모두 성공했습니다.",
    "Ran pnpm test successfully.",
    "- [x] All tests passed successfully.",
    "Validation: Verified with npm run build.",
    "You can trigger a rebase by commenting `@update-bot rebase`.",
    "[![Build](https://example.test/build.svg)](https://example.test/build)"
  ])("does not promote isolated noise through authoritative fallback: %s", (text) => {
    expect(extractRequirementSpanSeed(text, "", "issue").seed?.spans).toEqual([]);
    expect(extractRequirementSpanSeed("", text).seed?.spans).toEqual([]);
    expect(extractRequirementEvidence(text, "", "issue").requirements).toMatchObject([{ source: "manual", sourceQuality: "manual_check" }]);
    expect(extractRequirementEvidence("", text).requirements).toEqual([]);
  });

  it("excludes passive execution and environment reports from testing sections", () => {
    const description = [
      "## Testing",
      "The aggregate `npm test` command was also attempted.",
      "On this Windows checkout, XO reports its existing TypeScript project-service lookup error for `index.d.ts` and `index.test-d.ts`; the same error occurs on the untouched base.",
      "The integration test command was executed locally.",
      "On the local checkout, the runner encounters an existing configuration error.",
      "Add regression tests for session expiry."
    ].join("\n");
    expect(extractRequirementEvidence("", description).requirements.map((item) => item.text)).toEqual(["Add regression tests for session expiry"]);
    expect(extractRequirementSpanSeed("", description).seed?.spans.map((span) => span.text)).toEqual(["Add regression tests for session expiry."]);
  });

  it("distinguishes bot command usage documentation from requested bot behavior", () => {
    const usage = "`@helper show <dependency name> ignore conditions` will show all of the ignore conditions of the specified dependency";
    expect(extractRequirementEvidence("", usage).requirements).toEqual([]);
    expect(extractRequirementSpanSeed("", usage).seed?.spans).toEqual([]);
    const requirement = "The bot must show ignore conditions only to authorized users.";
    expect(extractRequirementEvidence("", requirement).requirements.map((item) => item.text)).toEqual([requirement.slice(0, -1)]);
    const change = "Implement `@helper show` to show ignore conditions only to authorized users.";
    expect(extractRequirementEvidence("", change).requirements.map((item) => item.text)).toEqual([change.slice(0, -1)]);
  });

  it.each([
    "All 42 unit tests passed and added retry handling.",
    "Tests: add regression coverage for expired sessions.",
    "All unit tests must pass before deployment.",
    "테스트를 실행했고 오류 메시지를 표시한다.",
    "테스트를 실행했고 세션 만료를 방지하도록 수정했습니다."
  ])("preserves substantive or prospective behavior alongside result vocabulary: %s", (text) => {
    expect(extractRequirementSpanSeed(text, "", "issue").seed?.spans.map((span) => span.text)).toEqual([text]);
    expect(extractRequirementSpanSeed("", text).seed?.spans.map((span) => span.text)).toEqual([text]);
    expect(extractRequirementEvidence("", text).requirements.map((item) => item.text)).toEqual([text.slice(0, -1)]);
  });

  it("reconstructs canonical test antecedent bindings after dropping source noise", () => {
    const taskText = [
      "Acceptance criteria:",
      "- Ran pnpm test successfully.",
      "- Add repository visibility labels.",
      "- Add focused tests for both paths."
    ].join("\r\n");
    const canonical = selectCanonicalRequirements({ kind: "selected_source", input: { taskText, description: "", taskSource: "issue" } });
    const relations = deriveDeterministicRequirementRelations(canonical);
    expect(toReportRequirements(canonical).map((item) => item.text)).toEqual([
      "Add repository visibility labels", "Add focused tests for both paths"
    ]);
    expect(relations.deterministicRelationsByRequirement.get("req_2")).toMatchObject({ kind: "test_antecedent", antecedentRequirementId: "req_1" });
    expect(relations.sourceBindingsByRef.size).toBe(2);
    const spans = extractRequirementSpanSeed(taskText, "", "issue").seed?.spans ?? [];
    expect(spans.map((span) => span.text)).toEqual(["- Add repository visibility labels.", "- Add focused tests for both paths."]);
    expect(spans.every((span) => taskText.slice(span.start, span.end) === span.text)).toBe(true);
    expect(extractRequirementEvidence(taskText, "", "issue").contexts).toEqual([]);
  });
});
