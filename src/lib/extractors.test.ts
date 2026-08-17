import { describe, expect, it, vi } from "vitest";
import {
  buildEvidenceIndex,
  buildEvidenceIndexResult,
  extractClaims,
  extractKeywords,
  extractRequirementEvidence,
  extractRequirementSpanSeed,
  extractRequirements,
  visibleSourceRangesFromCursor
} from "./extractors";

describe("extractRequirements", () => {
  it("stable-buckets capped evidence in the same rank/insertion order", () => {
    const changedFiles = Array.from({ length: 205 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      status: "modified" as const,
      patch: index % 2 === 0 ? `+ change ${index}` : undefined
    }));
    const result = buildEvidenceIndexResult(
      "Add bounded behavior.",
      "Synthetic author context.",
      changedFiles,
      [
        { name: "failing tests", status: "failed" as const },
        { name: "passing tests", status: "passed" as const }
      ],
      []
    );
    const rank = (kind: string, summary: string) => {
      if ((kind === "check" || kind === "log") && /Status:\s*(failure|failed|error|cancelled|timed_out)/i.test(summary)) return 0;
      if ((kind === "check" || kind === "log") && /Status:\s*(pending|in_progress|queued|unknown)/i.test(summary)) return 1;
      if (kind === "check" || kind === "log") return 2;
      if (kind === "test" || kind === "diff") return 3;
      if (kind === "task" || kind === "pr_description") return 4;
      return 5;
    };

    expect(result.items).toHaveLength(200);
    expect(result.items.map((item) => rank(item.kind, item.summary))).toEqual(
      [...result.items].map((item) => rank(item.kind, item.summary)).sort((left, right) => left - right)
    );
    for (let index = 1; index < result.items.length; index += 1) {
      const previous = result.items[index - 1];
      const current = result.items[index];
      if (rank(previous.kind, previous.summary) === rank(current.kind, current.summary)) {
        expect(Number(previous.id.slice(3))).toBeLessThan(Number(current.id.slice(3)));
      }
    }
    expect(Object.values(result.omittedByKind).reduce((sum, count) => sum + (count ?? 0), 0)).toBe(9);
  });

  it("marks requirements from linked issue text as issue-sourced", () => {
    const requirements = extractRequirements(
      "Linked issue acme/repo#42: Reject expired reset links\n\nAcceptance criteria:\n- Reject expired reset links.\n- Add regression coverage.",
      "Fixes #42",
      "issue"
    );

    expect(requirements[0].source).toBe("issue");
    expect(requirements[0].role).toBe("core_requirement");
    expect(requirements.some((requirement) => requirement.sourceQuality === "explicit_acceptance_criteria")).toBe(true);
    expect(requirements.map((requirement) => requirement.text).join(" ")).toContain("Reject expired reset links");
  });

  it("keeps explicit unlinked PR objectives while excluding fixture-purpose prose", () => {
    const requirements = extractRequirements(
      "",
      [
        "## AgentProof live smoke fixture",
        "This is an intentionally small, Issue-unlinked PR for validating the review pipeline.",
        "### Requirements",
        "- Add repositorySlug(repository) that returns owner/name when both values are present.",
        "- Return unknown/repository when an owner or name is unavailable.",
        "- Add focused tests for the normal and fallback paths.",
        "### Validation",
        "- pnpm test (3 passing tests)"
      ].join("\n")
    );

    expect(requirements.map((requirement) => requirement.text)).toEqual([
      "Add repositorySlug(repository) that returns owner/name when both values are present",
      "Return unknown/repository when an owner or name is unavailable",
      "Add focused tests for the normal and fallback paths"
    ]);
  });

  it("excludes a pure PR evidence inventory while retaining report behavior", () => {
    for (const inventory of [
      "This PR provides changed-file and test evidence.",
      "The change contains checks, tests, and logs.",
      "The fixture lists screenshots and analysis inputs.",
      "This scenario limits evidence to changed files, checks, tests, and logs."
    ]) {
      expect(extractRequirements("", [
        "## Requirements",
        `- ${inventory}`
      ].join("\n")), inventory).toEqual([]);
    }

    expect(extractRequirements("", [
      "## Requirements",
      "- Show evidence in the report export."
    ].join("\n"))).toHaveLength(1);
  });

  it("excludes evaluation context from PR objectives without dropping a real scope constraint", () => {
    const requirements = extractRequirements(
      "",
      [
        "## Requirements",
        "- Add a retry status label.",
        "- Add focused tests for both retry paths.",
        "- Do not change implementation code outside the retry module.",
        "",
        "## Evaluation context",
        "This is an unmerged private canary for exercising the review pipeline.",
        "It changes only the retry label and its focused test.",
        "",
        "## Fixture notes",
        "This scenario is used to validate the report export benchmark."
      ].join("\n")
    );

    expect(requirements.map((requirement) => requirement.text)).toEqual([
      "Add a retry status label",
      "Add focused tests for both retry paths",
      "Do not change implementation code outside the retry module"
    ]);
  });

  it("does not discard a product objective merely because its section mentions a benchmark or demo", () => {
    const requirements = extractRequirements(
      "",
      [
        "## Performance benchmark",
        "- Add a p95 latency metric to the repository overview.",
        "",
        "## Demo behavior",
        "- Show the demo badge when preview mode is enabled.",
        "",
        "## Summary",
        "This PR adds a demo mode for reviewers."
      ].join("\n")
    );

    expect(requirements.map((requirement) => requirement.text)).toEqual([
      "Add a p95 latency metric to the repository overview",
      "Show the demo badge when preview mode is enabled",
      "This PR adds a demo mode for reviewers"
    ]);
  });

  it("does not promote Korean review-pipeline self-test prose into a PR objective", () => {
    const extraction = extractRequirementEvidence("", "이 PR은 검토 파이프라인을 테스트합니다.");

    expect(extraction.requirements).toEqual([]);
  });

  it("does not invent a requirement when an unlinked PR has no concrete objective", () => {
    const extraction = extractRequirementEvidence("", "Improve background processing.");

    expect(extraction.requirements).toEqual([]);
  });

  it("recognizes an explicit Spanish documentation objective", () => {
    const extraction = extractRequirementEvidence("", "Documentar el reinicio del entorno local con tres pasos reproducibles.");

    expect(extraction.requirements).toHaveLength(1);
    expect(extraction.requirements[0]?.sourceQuality).toBe("author_claim");
    expect(extraction.requirements[0]?.text).toContain("Documentar el reinicio");
  });

  it("recognizes an explicit responsive preservation objective", () => {
    const extraction = extractRequirementEvidence("", "Keep the compact settings panel readable at 375px.");

    expect(extraction.requirements).toHaveLength(1);
    expect(extraction.requirements[0]?.text).toContain("readable at 375px");
  });

  it("ignores GitHub issue template comments and fenced traces", () => {
    const requirements = extractRequirements(
      [
        "IndexError: tuple index out of range in identify_format (io.registry)",
        "<!-- This comments are hidden when you submit the issue,",
        "so you do not need to remove them! -->",
        "<!-- Please be sure to check out our contributing guidelines,",
        "https://github.com/astropy/astropy/blob/main/CONTRIBUTING.md . -->",
        "### Description",
        "Cron tests using identify_format started failing with IndexError.",
        "Citing the maintainer: when `filepath` is a string without a FITS extension, the function executes `isinstance(args[0], ...)`.",
        "### Steps to Reproduce",
        "```",
        "Traceback (most recent call last):",
        "  File \"connect.py\", line 72, in is_fits",
        "IndexError: tuple index out of range",
        "```",
        "### System Details",
        "Python 3.10"
      ].join("\n"),
      ""
    );
    const requirementText = requirements.map((requirement) => requirement.text).join("\n");

    expect(requirementText).toContain("identify_format");
    expect(requirementText).toContain("filepath");
    expect(requirementText).toContain("FITS extension");
    expect(requirementText).not.toMatch(/hidden when|contributing guidelines|Traceback|System Details|Steps to Reproduce/i);
  });

  it("redacts evidence labels and strips URL credentials, query, and hash fragments", () => {
    const evidence = buildEvidenceIndex(
      "Acceptance criteria: keep api_key=sk-abcdefghijklmnopqrstuvwxyz123456 out of reports.",
      "Implemented handling for token=github_pat_abcdefghijklmnopqrstuvwxyz123456.",
      [],
      [
        {
          name: "unit tests: passed token=ghp_abcdefghijklmnopqrstuvwxyz123456",
          status: "unknown",
          summary: "previous run passed with sk-abcdefghijklmnopqrstuvwxyz123456",
          url: "https://user:pass@github.com/acme/repo/actions/runs/1?token=ghp_abcdefghijklmnopqrstuvwxyz123456#step"
        }
      ],
      [
        {
          source: "pasted logs sk-abcdefghijklmnopqrstuvwxyz123456",
          status: "passed",
          text: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz.1234567890\nunit tests passed"
        }
      ]
    );
    const serialized = JSON.stringify(evidence);
    const checkEvidence = evidence.find((item) => item.kind === "check");
    const logEvidence = evidence.find((item) => item.kind === "log");

    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("Bearer abc");
    expect(checkEvidence?.locator).toBe("https://github.com/acme/repo/actions/runs/1");
    expect(checkEvidence?.summary).toMatch(/^Status: unknown\./);
    expect(logEvidence?.summary).toMatch(/^Status: passed\./);
  });

  it("classifies files under top-level tests directories as test evidence", () => {
    const evidence = buildEvidenceIndex(
      "",
      "",
      [
        {
          path: "tests/validators/invalid_urls.txt",
          status: "modified",
          patch: "+ http://invalid example"
        }
      ],
      [],
      []
    );

    expect(evidence[0]?.kind).toBe("test");
  });

  it("splits dotted and CamelCase API identifiers into matchable keywords", () => {
    expect(extractKeywords("io.fits.FITSDiff should handle variable-length arrays.")).toEqual(
      expect.arrayContaining(["fits", "diff", "variable", "length", "arrays"])
    );
  });

  it("keeps common technical aliases for issue-to-patch matching", () => {
    expect(extractKeywords("NumPy proxy authentication pickling failures")).toEqual(
      expect.arrayContaining(["numpy", "np", "proxy", "authentication", "auth", "pickling", "pickle"])
    );
  });

  it("drops issue-template headings without dropping useful expected behavior", () => {
    const result = extractRequirementEvidence(
      [
        "[Bug]: Unable to pickle figure with aligned labels",
        "### Bug summary",
        "Unable to pickle figure after calling `align_labels()`.",
        "### Code for reproduction",
        "```python",
        "fig.align_ylabels()",
        "pickle.dumps(fig)",
        "```",
        "### Expected outcome",
        "Pickling successful.",
        "### Additional information",
        "_No response_"
      ].join("\n"),
      ""
    );
    const requirements = result.requirements;
    const text = requirements.map((requirement) => requirement.text).join("\n");
    const contextText = result.contexts.map((context) => context.text).join("\n");

    expect(text).toContain("Pickling successful");
    expect(contextText).toContain("Unable to pickle figure");
    expect(result.contexts.some((context) => context.role === "problem_context")).toBe(true);
    expect(text).not.toMatch(/Bug summary|Code for reproduction|Expected outcome|Additional information|No response/i);
  });

  it("drops REPL prompts from requirement text", () => {
    const result = extractRequirementEvidence(
      [
        "Latex parsing of fractions yields wrong expression due to missing brackets.",
        "## Reproduce:",
        "```",
        "root@example:/# python3",
        "Python 3.11.0",
        ">>> from sympy.parsing.latex import parse_latex",
        ">>> parse_latex('x')",
        "x",
        "```",
        "Expected is a correctly grouped denominator."
      ].join("\n"),
      ""
    );
    const text = result.requirements.map((requirement) => requirement.text).join("\n");
    const contextText = result.contexts.map((context) => context.text).join("\n");

    expect(contextText).toContain("Latex parsing");
    expect(text).toContain("Expected is a correctly grouped denominator");
    expect(text).not.toContain("parse_latex");
    expect(text).not.toContain("python3");
  });

  it("treats PR-body summary and validation as author claims when task text is absent", () => {
    const result = extractRequirementEvidence(
      "",
      [
        "## Summary",
        "Rework report UI around evidence cards.",
        "",
        "## Validation",
        "- corepack pnpm test",
        "- corepack pnpm typecheck",
        "- corepack pnpm build"
      ].join("\n")
    );
    const requirementText = result.requirements.map((requirement) => requirement.text).join("\n");
    const contextText = result.contexts.map((context) => context.text).join("\n");

    expect(requirementText).toContain("Rework report UI around evidence cards");
    expect(result.requirements[0]?.source).toBe("pr_description");
    expect(result.requirements[0]?.sourceQuality).toBe("author_claim");
    expect(contextText).toContain("Rework report UI around evidence cards");
    expect(result.contexts.some((context) => context.role === "author_claim")).toBe(true);
    expect(requirementText).not.toMatch(/Validation|corepack|pnpm|typecheck|build/i);
  });

  it("keeps Node runtime requirements while still dropping node command lines", () => {
    const requirements = extractRequirements(
      [
        "Acceptance criteria:",
        "- Node should handle malformed input without crashing.",
        "- node scripts/repro.js"
      ].join("\n"),
      ""
    );
    const text = requirements.map((requirement) => requirement.text).join("\n");

    expect(text).toContain("Node should handle malformed input without crashing");
    expect(text).not.toContain("node scripts/repro.js");
  });

  it("drops Electron template metadata while keeping expected crash behavior as the requirement", () => {
    const result = extractRequirementEvidence(
      [
        "### Preflight Checklist",
        "[x] I have read the contributing guidelines.",
        "### Electron Version",
        "38.0.0-nightly",
        "### What operating system(s) are you using?",
        "Windows",
        "### Actual behavior",
        "Replacing menu while open causes a segfault on Windows.",
        "### Expected behavior",
        "Menu.setApplicationMenu should not crash while the user interacts with an open menu."
      ].join("\n"),
      "",
      "issue"
    );
    const requirementText = result.requirements.map((requirement) => requirement.text).join("\n");
    const contextText = result.contexts.map((context) => context.text).join("\n");

    expect(requirementText).toContain("Menu.setApplicationMenu should not crash");
    expect(result.requirements[0]?.sourceQuality).toBe("expected_behavior");
    expect(result.contexts.some((context) => context.role === "environment_context" && /Windows|38/.test(context.text))).toBe(true);
    expect(result.contexts.some((context) => context.role === "problem_context" && /segfault/.test(context.text))).toBe(true);
    expect(requirementText).not.toMatch(/Preflight|Electron Version|operating system|contributing guidelines/i);
    expect(contextText).not.toMatch(/Preflight Checklist|contributing guidelines/i);
  });

  it("keeps Django PR template metadata out while retaining the PR author intent", () => {
    const result = extractRequirementEvidence(
      "",
      [
        "#### Trac ticket number",
        "26434",
        "#### Branch description",
        "This PR fixes SQL formatting crash when debug SQL includes parameters.",
        "#### AI Assistance Disclosure (REQUIRED)",
        "[x] If AI tools were used, I have disclosed which ones, and fully reviewed and verified their output."
      ].join("\n")
    );
    const requirementText = result.requirements.map((requirement) => requirement.text).join("\n");
    const contextText = result.contexts.map((context) => context.text).join("\n");

    expect(requirementText).toContain("This PR fixes SQL formatting crash");
    expect(result.requirements[0]?.sourceQuality).toBe("author_claim");
    expect(contextText).toContain("SQL formatting crash");
    expect(result.contexts.some((context) => context.role === "external_reference")).toBe(true);
    expect(result.contexts.some((context) => context.role === "author_claim")).toBe(true);
    expect(requirementText).not.toMatch(/Trac ticket|Branch description|AI Assistance|AI tools/i);
  });

  it("treats PR-body acceptance language as author claims when no task source exists", () => {
    const result = extractRequirementEvidence(
      "",
      [
        "### Acceptance criteria",
        "The widget should preserve search params.",
        "### Testing",
        "I verified the unit tests pass."
      ].join("\n")
    );
    const requirementText = result.requirements.map((requirement) => requirement.text).join("\n");

    expect(result.requirements[0]?.sourceQuality).toBe("author_claim");
    expect(requirementText).toContain("The widget should preserve search params");
    expect(result.contexts.some((context) =>
      context.role === "author_claim" && /preserve search params/i.test(context.text)
    )).toBe(true);
  });

  it("extracts Korean linked-issue requirements without promoting the issue title", () => {
    const result = extractRequirementEvidence(
      [
        "Linked issue RengGyu/repo#2: 만료된 저장소 연결 UI 추가",
        "",
        "저장소 연결이 만료되면 Reconnect 버튼을 표시한다.",
        "버튼 클릭 시 GitHub 연결 화면으로 이동한다.",
        "만료 상태의 저장소는 PR 분석을 시작할 수 없어야 한다."
      ].join("\n"),
      "만료 상태와 Reconnect 버튼을 추가함.",
      "issue"
    );

    expect(result.requirements.map((item) => item.text)).toEqual([
      "저장소 연결이 만료되면 Reconnect 버튼을 표시한다",
      "버튼 클릭 시 GitHub 연결 화면으로 이동한다",
      "만료 상태의 저장소는 PR 분석을 시작할 수 없어야 한다"
    ]);
    expect(result.contexts.some((item) => item.sourceSection === "linked_issue_title")).toBe(true);
  });

  it("extracts mixed Korean product requirements without duplicating the linked issue title", () => {
    const result = extractRequirementEvidence(
      [
        "Linked issue RengGyu/repo#4: Show changed file count on PR details",
        "",
        "PR 상세 화면에서 changed files 수를 표시한다.",
        "기존 repository detail 동작은 유지한다."
      ].join("\n"),
      "changed-file count를 상세 화면에 추가.",
      "issue"
    );

    expect(result.requirements).toHaveLength(2);
    expect(result.requirements.map((item) => item.text).join(" ")).not.toContain("Show changed file count on PR details");
  });

  it("keeps suggested fix sections as solution hints instead of core requirements", () => {
    const result = extractRequirementEvidence(
      [
        "### Actual behavior",
        "The PostCSS watcher returns stale output when input CSS changes without an mtime update.",
        "### Suggested fix",
        "Invalidate the compiler cache whenever the input text changes.",
        "### Environment",
        "Node 22 on macOS"
      ].join("\n"),
      "",
      "issue"
    );
    const requirementText = result.requirements.map((requirement) => requirement.text).join("\n");

    expect(requirementText).toContain("stale output");
    expect(requirementText).not.toContain("Invalidate the compiler cache");
    expect(result.contexts.some((context) =>
      context.role === "solution_hint" && /compiler cache/i.test(context.text)
    )).toBe(true);
  });

  it("treats standalone would-fix implementation advice as a solution hint", () => {
    const result = extractRequirementEvidence(
      [
        "Preflight applies auto outline to focus-visible iframes.",
        "Deleting this rule would fix the problem: packages/theme/preflight.css#L173-L175"
      ].join("\n"),
      "",
      "issue"
    );
    const requirementText = result.requirements.map((requirement) => requirement.text).join("\n");

    expect(requirementText).toContain("Preflight applies auto outline");
    expect(requirementText).not.toContain("Deleting this rule would fix");
    expect(result.contexts.some((context) =>
      context.role === "solution_hint" && /Deleting this rule/i.test(context.text)
    )).toBe(true);
  });

  it("keeps Terraform expected behavior as requirement while preserving debug and environment context", () => {
    const result = extractRequirementEvidence(
      [
        "### Terraform Version",
        "1.13.4",
        "### Terraform Configuration Files",
        "main.tf.json",
        "### Debug Output",
        "Missing required argument error on main.tf.json",
        "### Expected Behavior",
        "cdktf get should have ran successfully."
      ].join("\n"),
      "",
      "issue"
    );
    const requirementText = result.requirements.map((requirement) => requirement.text).join("\n");

    expect(requirementText).toContain("cdktf get should have ran successfully");
    expect(result.requirements[0]?.sourceQuality).toBe("expected_behavior");
    expect(result.contexts.some((context) => context.role === "environment_context" && /1.13.4|main.tf.json|Missing required argument/.test(context.text))).toBe(true);
    expect(requirementText).not.toMatch(/Terraform Version|Configuration Files|Debug Output/i);
  });
});

describe("extractRequirementSpanSeed", () => {
  it("keeps only contexts from the one selected seed source without changing essential extraction", () => {
    const issue = [
      "Acceptance criteria: Add retry handling.",
      "Background context: retry failures must remain visible."
    ].join("\n");
    const pr = "Summary: this pull request changes deployment notes.";
    const essential = extractRequirementEvidence(issue, pr, "issue");
    const linked = extractRequirementSpanSeed(issue, pr, "issue");
    const unlinked = extractRequirementSpanSeed("", "Summary: Add retry handling. Background context: retry failures must remain visible.");
    const provided = extractRequirementSpanSeed("Acceptance criteria: Add retry handling. Background context: retain the audit trail.", pr, "task");

    expect(essential.contexts.some((context) => context.source === "pr_description")).toBe(true);
    expect(linked.seed?.contexts.every((context) => context.source === "issue")).toBe(true);
    expect(unlinked.seed?.contexts.every((context) => context.source === "pr_description")).toBe(true);
    expect(provided.seed?.contexts.every((context) => context.source === "task")).toBe(true);
  });

  it("keeps list items, terminal sentences, and remaining lines as the only boundaries", () => {
    const source = [
      "## Acceptance criteria",
      "- Add retry handling.",
      "- Document the fallback",
      "Keep errors visible. Preserve the retry state!",
      "Fix and document the queue"
    ].join("\n");

    const result = extractRequirementSpanSeed(source, "", "issue");

    expect(result).toMatchObject({ eligible: true, overflow: false });
    expect(result.seed?.spans.map((span) => span.text)).toEqual([
      "- Add retry handling.",
      "- Document the fallback",
      "Keep errors visible.",
      "Preserve the retry state!",
      "Fix and document the queue"
    ]);
    expect(result.seed?.spans.map((span) => span.id)).toEqual([
      "sp_1_1",
      "sp_1_2",
      "sp_1_3",
      "sp_1_4",
      "sp_1_5"
    ]);
  });

  it("uses exact UTF-16 source offsets and resets groups at headings and blank lines", () => {
    const source = [
      "## First",
      "Add one.",
      "Preserve two",
      "",
      "## Second",
      "Add three."
    ].join("\n");
    const result = extractRequirementSpanSeed(source, "", "issue");
    const spans = result.seed?.spans ?? [];

    expect(spans.map(({ groupId, ordinal, immediateParentSpanId }) => ({ groupId, ordinal, immediateParentSpanId }))).toEqual([
      { groupId: "grp_1", ordinal: 1, immediateParentSpanId: null },
      { groupId: "grp_1", ordinal: 2, immediateParentSpanId: "sp_1_1" },
      { groupId: "grp_2", ordinal: 1, immediateParentSpanId: null }
    ]);
    expect(spans.every((span) => source.slice(span.start, span.end) === span.text)).toBe(true);
    expect(spans.map((span) => [span.start, span.end])).toEqual([
      [source.indexOf("Add one."), source.indexOf("Add one.") + "Add one.".length],
      [source.indexOf("Preserve two"), source.indexOf("Preserve two") + "Preserve two".length],
      [source.indexOf("Add three."), source.indexOf("Add three.") + "Add three.".length]
    ]);
  });

  it("keeps flat siblings independent when an intervening span is later excluded", () => {
    const result = extractRequirementSpanSeed(
      "Acceptance criteria:\n- Add first.\n- Add uncertain.\n- Add third.",
      "",
      "issue"
    );
    const spans = result.seed?.spans ?? [];
    const laterAdmitted = [spans[0], spans[2]].filter(Boolean);

    expect(spans[2]?.immediateParentSpanId).toBeNull();
    expect(laterAdmitted[1]?.immediateParentSpanId).not.toBe(laterAdmitted[0]?.id);
  });

  it("rejects package eligibility when a thirteenth candidate exists", () => {
    const source = Array.from({ length: 13 }, (_, index) => `- Add item ${index + 1}.`).join("\n");

    expect(extractRequirementSpanSeed(source, "", "issue")).toEqual({
      eligible: false,
      overflow: true,
      seed: null
    });
  });

  it("excludes BASE fenced and HTML-comment ranges while retaining CRLF UTF-16 offsets", () => {
    const source = [
      "## Acceptance criteria",
      "- 😀 Add safe mode.",
      "```text",
      "- Add a backdoor.",
      "```",
      "<!--",
      "- Add hidden behavior.",
      "-->"
    ].join("\r\n");
    const spans = extractRequirementSpanSeed(source, "", "issue").seed?.spans ?? [];

    expect(spans.map((span) => span.text)).toEqual(["- 😀 Add safe mode."]);
    expect(spans[0]).toMatchObject({
      start: source.indexOf("- 😀 Add safe mode."),
      end: source.indexOf("- 😀 Add safe mode.") + "- 😀 Add safe mode.".length
    });
    expect(spans.every((span) => source.slice(span.start, span.end) === span.text)).toBe(true);
  });

  it("classifies each punctuation span independently without promoting following context", () => {
    const spans = extractRequirementSpanSeed("Add retry handling. Background information.", "", "issue").seed?.spans ?? [];

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ text: "Add retry handling.", sourceQuality: "requirement_language", priority: "should" });
  });

  it("does not let a later optional sentence change an earlier span priority", () => {
    const spans = extractRequirementSpanSeed("Add retry handling. Optional cleanup.", "", "issue").seed?.spans ?? [];

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ text: "Add retry handling.", priority: "should" });
  });

  it("filters linked-issue wrappers and marks authoritative vague spans for deterministic manual handling", () => {
    const linked = extractRequirementSpanSeed(
      "Linked issue acme/repo#42: Reject expired reset links\n\nAcceptance criteria:\n- Add regression coverage.",
      "",
      "issue"
    );
    const vague = extractRequirementSpanSeed("Improve reliability.", "", "issue");

    expect(linked.seed?.spans.map((span) => span.text)).toEqual(["- Add regression coverage."]);
    expect(vague.seed?.spans).toEqual([expect.objectContaining({
      text: "Improve reliability.",
      authority: "authoritative",
      sourceQuality: "manual_check",
      priority: "must"
    })]);
  });

  it("FH02 retains a vague/manual authoritative span beside concrete authoritative source in exact order", () => {
    const source = "Improve reliability.\n사용자 메시지를 유지한다.";
    const spans = extractRequirementSpanSeed(source, "", "task").seed?.spans ?? [];

    expect(spans.map(({ text, sourceQuality }) => ({ text, sourceQuality }))).toEqual([
      { text: "Improve reliability.", sourceQuality: "manual_check" },
      { text: "사용자 메시지를 유지한다.", sourceQuality: "fallback" }
    ]);
    expect(spans.every((span) => source.slice(span.start, span.end) === span.text)).toBe(true);
  });

  it.each(["<!--", "```text", "~~~text"])("excludes from an unmatched %s opener through EOF without shifting visible offsets", (opener) => {
    const source = ["- 😀 Add visible mode.", opener, "- Add hidden behavior."].join("\r\n");
    const spans = extractRequirementSpanSeed(source, "", "issue").seed?.spans ?? [];

    expect(spans.map((span) => span.text)).toEqual(["- 😀 Add visible mode."]);
    expect(spans[0]).toMatchObject({
      start: 0,
      end: "- 😀 Add visible mode.".length
    });
    expect(spans.every((span) => source.slice(span.start, span.end) === span.text)).toBe(true);
  });

  it("retains high-recall unlinked PR candidates for planner classification", () => {
    const mixed = extractRequirementSpanSeed(
      "",
      "This PR adds retry handling and exists to evaluate the verification pipeline."
    );
    const noAction = extractRequirementSpanSeed("", "Retry behavior for transient failures.");
    const meta = extractRequirementSpanSeed("", "This PR exists to evaluate the verification pipeline.");

    expect(mixed.seed?.spans.map((span) => span.text)).toEqual([
      "This PR adds retry handling and exists to evaluate the verification pipeline."
    ]);
    expect(noAction.seed?.spans.map((span) => span.text)).toEqual(["Retry behavior for transient failures."]);
    expect(meta.seed?.spans.map((span) => span.text)).toEqual(["This PR exists to evaluate the verification pipeline."]);
    expect([...mixed.seed?.spans ?? [], ...noAction.seed?.spans ?? [], ...meta.seed?.spans ?? []]
      .every((span) => span.authority === "pr_author_claim")).toBe(true);
  });

  it("keeps PR source hygiene filters while counting every surviving candidate toward overflow", () => {
    const hygienic = extractRequirementSpanSeed("", [
      "## Summary",
      "Retry behavior for transient failures.",
      "## Testing",
      "pnpm test",
      "Tests passed successfully.",
      "## Suggested fix",
      "Add a workaround.",
      "## External issue",
      "JIRA-123"
    ].join("\n"));
    const thirteen = extractRequirementSpanSeed(
      "",
      Array.from({ length: 13 }, (_, index) => `Candidate description ${index + 1}.`).join("\n")
    );

    expect(hygienic.seed?.spans.map((span) => span.text)).toEqual(["Retry behavior for transient failures."]);
    expect(thirteen).toEqual({ eligible: false, overflow: true, seed: null });
  });

  it.each([
    ["`", 3],
    ["`", 4],
    ["`", 5],
    ["~", 3],
    ["~", 4],
    ["~", 5]
  ])("keeps nested shorter and different %s fences hidden while same-or-longer %i fences close", (marker, length) => {
    const otherMarker = marker === "`" ? "~" : "`";

    for (const closeLength of [length, length + 1]) {
      const source = [
        "😀 Add visible prefix.",
        `  ${marker.repeat(length)} text`,
        ...(length > 3 ? [marker.repeat(length - 1)] : []),
        "- Add hidden behavior.",
        otherMarker.repeat(length + 1),
        marker.repeat(closeLength),
        "Preserve visible suffix."
      ].join("\r\n");
      const spans = extractRequirementSpanSeed(source, "", "issue").seed?.spans ?? [];

      expect(spans.map((span) => span.text)).toEqual(["😀 Add visible prefix.", "Preserve visible suffix."]);
      expect(spans.every((span) => source.slice(span.start, span.end) === span.text)).toBe(true);
      expect(spans[0]?.start).toBe(0);
      expect(spans[1]?.start).toBe(source.indexOf("Preserve visible suffix."));
    }
  });

  it.each([
    ["`", 3],
    ["`", 4],
    ["`", 5],
    ["~", 3],
    ["~", 4],
    ["~", 5]
  ])("excludes an unterminated %s fence of length %i through EOF", (marker, length) => {
    const source = ["😀 Add visible prefix.", marker.repeat(length), "- Add hidden behavior."].join("\r\n");
    const spans = extractRequirementSpanSeed(source, "", "issue").seed?.spans ?? [];

    expect(spans.map((span) => span.text)).toEqual(["😀 Add visible prefix."]);
    expect(spans[0]?.end).toBe("😀 Add visible prefix.".length);
  });

  it.each(["\n", "\r\n", "\r"])("scans %j line endings without accepting fence closers with trailing content", (lineEnding) => {
    for (const marker of ["`", "~"] as const) {
      for (const length of [3, 4, 5]) {
        const otherMarker = marker === "`" ? "~" : "`";
        const source = [
          "😀 Add visible prefix.",
          `${marker.repeat(length)} text`,
          marker.repeat(length - 1),
          otherMarker.repeat(length + 1),
          `${marker.repeat(length)} not-a-close`,
          "- Add hidden behavior.",
          marker.repeat(length + 1),
          "Preserve visible suffix."
        ].join(lineEnding);
        const spans = extractRequirementSpanSeed(source, "", "issue").seed?.spans ?? [];

        expect(spans.map((span) => span.text)).toEqual(["😀 Add visible prefix.", "Preserve visible suffix."]);
        expect(spans.every((span) => source.slice(span.start, span.end) === span.text)).toBe(true);
        expect(spans[0]?.start).toBe(0);
        expect(spans[1]?.start).toBe(source.indexOf("Preserve visible suffix."));
      }
    }
  });

  it("treats comment and fence bodies as mutually opaque while preserving visible UTF-16 offsets", () => {
    const commentWithFence = [
      "😀 Add visible prefix.",
      "<!--",
      "```",
      "- Add hidden comment behavior.",
      "-->",
      "Preserve visible suffix."
    ].join("\r");
    const fenceWithComment = [
      "😀 Add visible prefix.",
      "~~~~",
      "<!--",
      "- Add hidden fence behavior.",
      "-->",
      "~~~~~",
      "Preserve visible suffix."
    ].join("\n");

    for (const source of [commentWithFence, fenceWithComment]) {
      const spans = extractRequirementSpanSeed(source, "", "issue").seed?.spans ?? [];
      expect(spans.map((span) => span.text)).toEqual(["😀 Add visible prefix.", "Preserve visible suffix."]);
      expect(spans.every((span) => source.slice(span.start, span.end) === span.text)).toBe(true);
      expect(spans[1]?.start).toBe(source.indexOf("Preserve visible suffix."));
    }
  });

  it("advances excluded-range lookup monotonically instead of rescanning prior ranges per source line", () => {
    const numericReads = (size: number) => {
      let reads = 0;
      const excluded = new Proxy(
        Array.from({ length: size }, (_, index) => ({
          start: index * 4 + 1,
          end: index * 4 + 2
        })),
        {
          get(target, property, receiver) {
            if (typeof property === "string" && /^\d+$/.test(property)) reads += 1;
            return Reflect.get(target, property, receiver);
          }
        }
      );
      let excludedRangeCursor = 0;

      for (let index = 0; index < size; index += 1) {
        const partition = visibleSourceRangesFromCursor(
          index * 4,
          index * 4 + 3,
          excluded,
          excludedRangeCursor
        );
        excludedRangeCursor = partition.nextExcludedRangeIndex;
      }
      return reads;
    };

    const oneK = numericReads(1_024);
    const twoK = numericReads(2_048);
    expect(oneK).toBeLessThanOrEqual(6 * 1_024);
    expect(twoK).toBeLessThanOrEqual(6 * 2_048);
    expect(twoK).toBeLessThanOrEqual(oneK * 2 + 8);
  });

  it("classifies many source spans without rereading the complete source once per span", () => {
    let wholeSourceScans = 0;
    const originalTest = RegExp.prototype.test;
    const regexTest = vi.spyOn(RegExp.prototype, "test").mockImplementation(function (this: RegExp, value: string) {
      if (this.source === "acceptance criteria|must|required|given|when|then") wholeSourceScans += 1;
      return originalTest.call(this, value);
    });
    const source = Array.from({ length: 1_024 }, (_, index) => `- Add bounded behavior ${index + 1}.`).join("\n");

    extractRequirementSpanSeed(source, "", "issue");
    regexTest.mockRestore();
    expect(wholeSourceScans).toBe(1);
  });
});

describe("extractClaims", () => {
  it("captures product and UX claim verbs used by agent-authored PRs", () => {
    const evidence = buildEvidenceIndex("", "", [
      {
        path: "src/components/ReportView.tsx",
        status: "modified",
        patch: "+ Reframe the workspace around evidence cards and rework the report into sections."
      }
    ], [], []);

    const claims = extractClaims(
      "Reframe the workspace around evidence cards. Rework the report into sections. Align UI and export copy.",
      evidence
    );
    const text = claims.map((claim) => claim.text).join("\n");

    expect(text).toContain("Reframe the workspace around evidence cards");
    expect(text).toContain("Rework the report into sections");
    expect(text).toContain("Align UI");
  });
});
