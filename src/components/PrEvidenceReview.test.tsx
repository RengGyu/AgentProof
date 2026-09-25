import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrEvidenceReview } from "./PrEvidenceReview";

describe("PrEvidenceReview", () => {
  it("renders objective evidence without satisfaction or coverage verdicts", () => {
    const html = renderToStaticMarkup(<PrEvidenceReview review={{
      mode: "objectives",
      source: { kind: "linked_issue", label: "Linked issue requirement source", authority: "issue_source" },
      objectives: [{
        id: "req_1",
        text: "Reject expired reset links.",
        code: [{ evidenceId: "ev_code", kind: "code", label: "src/reset.ts", relation: "observed", url: "https://github.com/acme/widget/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/reset.ts#L12", line: 12 }],
        tests: [{ evidenceId: "ev_test", kind: "test", label: "src/reset.test.ts", relation: "candidate" }],
        execution: [{ evidenceId: "ev_check", kind: "execution", label: "unit", relation: "observed", url: "https://github.com/acme/widget/actions/runs/7", executionMeaning: "Repository suite passed; individual test execution is not established." }],
        nextInspection: "Inspect the expiry branch.",
      }],
      changes: [],
      nextInspection: "Inspect the expiry branch.",
    }} />);

    expect(html).toContain("PR-to-Evidence Review");
    expect(html).toContain("Linked issue requirement source");
    expect(html).toContain("Observed evidence");
    expect(html).toContain("Candidate link");
    expect(html).toContain("individual test execution is not established");
    expect(html).toContain("Open first changed line");
    expect(html).toContain("Open check run");
    expect(html).not.toMatch(/fulfilled|coverage|requirement satisfied/i);
  });

  it("renders missing-objective input as a neutral collected-change summary", () => {
    const html = renderToStaticMarkup(<PrEvidenceReview review={{
      mode: "change_summary",
      source: null,
      objectives: [],
      changes: [{ evidenceId: "ev_code", kind: "code", label: "src/reset.ts", relation: "collected" }],
      nextInspection: "Review src/reset.ts.",
    }} />);

    expect(html).toContain("Collected changes");
    expect(html).toContain("src/reset.ts");
    expect(html).not.toMatch(/unknown purpose|missing description|source:/i);
  });

  it("does not add empty evidence groups after the first inspection is shown", () => {
    const html = renderToStaticMarkup(<PrEvidenceReview review={{
      mode: "objectives",
      source: null,
      objectives: [{
        id: "goal_1",
        text: "Inspect the reset change.",
        firstInspection: { evidenceId: "first_code", kind: "code", label: "src/reset.ts", relation: "candidate", whyInspect: "Changed reset branch." },
        code: [],
        tests: [],
        execution: [],
        nextInspection: "Inspect the changed reset branch.",
      }],
      changes: [],
      nextInspection: "Inspect the changed reset branch.",
    }} />);

    expect(html.match(/src\/reset\.ts/g)).toHaveLength(1);
    expect(html).not.toContain("<h4>Code</h4>");
    expect(html).not.toContain("<h4>Tests</h4>");
    expect(html).not.toContain("<h4>Execution</h4>");
    expect(html).not.toContain("Unconnected");
  });
  it("keeps reviewer questions in a closed disclosure while the reason and exact link stay visible", () => {
    const html = renderToStaticMarkup(<PrEvidenceReview review={{
      mode: "objectives", source: null, changes: [], nextInspection: "Inspect reset.",
      objectives: [{ id: "goal", text: "Reject expired links.", code: [], tests: [], execution: [], nextInspection: "Inspect reset.",
        firstInspection: { evidenceId: "first", kind: "code", label: "src/reset.ts", relation: "candidate", line: 12,
          url: "https://github.com/acme/widget/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/reset.ts#L12",
          whyInspect: "The expiry branch changed.", reviewQuestion: "Does this reject expired links?", uncertainty: "Execution not checked." } }],
    }} />);
    expect(html).toContain('<details class="muted small"><summary>Reviewer question</summary><p>Does this reject expired links?</p></details>');
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain('<p>The expiry branch changed.</p>');
    expect(html).toContain('src/reset.ts#L12');
    expect(html).toContain('Execution not checked.');
  });

  it.each([true, false])("omits a repeated next step while retaining the visible code, reason and uncertainty (ranked: %s)", (ranked) => {
    const item = { evidenceId: "first", kind: "code" as const, label: "src/reset.ts", relation: "candidate" as const, whyInspect: "The expiry branch changed.", uncertainty: "Execution not checked." };
    const html = renderToStaticMarkup(<PrEvidenceReview review={{
      mode: "objectives", source: null, changes: [], nextInspection: "Inspect src/reset.ts.",
      retrievalNote: "Bounded supplied-artifact search; whole repository not searched.",
      sourceLinks: [{ label: "PR", url: "https://github.com/acme/widget/pull/42" }],
      objectives: [{ id: "goal", text: "Reject expired links.", tests: [], execution: [],
        ...(ranked ? { firstInspection: item, code: [] } : { code: [item] }),
        nextInspection: ranked ? "Inspect src/reset.ts. The expiry branch changed." : "Inspect src/reset.ts." }]
    }} />);
    expect(html).not.toContain("Next to inspect:");
    expect(html.match(/The expiry branch changed\./g)).toHaveLength(1);
    expect(html).toContain("Candidate link");
    expect(html).toContain("Execution not checked.");
    expect(html).toMatch(/<details class="pr-evidence-context"><summary>Sources &amp; search scope<\/summary><p[^>]*>Bounded supplied-artifact search; whole repository not searched\.<\/p>/);
    expect(html).toContain('href="https://github.com/acme/widget/pull/42"');
  });

  it("keeps a distinct next step or missing-link warning visible", () => {
    const html = renderToStaticMarkup(<PrEvidenceReview review={{
      mode: "objectives", source: null, changes: [], nextInspection: "Review the evidence.",
      objectives: [
        { id: "goal", text: "Reject expired links.", firstInspection: { evidenceId: "first", kind: "code", label: "src/reset.ts", relation: "candidate" }, code: [], tests: [], execution: [], nextInspection: "Check the unchanged caller before deciding." },
        { id: "unlinked", text: "Log failed attempts.", code: [], tests: [], execution: [], nextInspection: "Link unconfirmed; not found does not mean not implemented." }
      ]
    }} />);
    expect(html).toContain("Check the unchanged caller before deciding.");
    expect(html).toContain("Link unconfirmed; not found does not mean not implemented.");
  });

});
