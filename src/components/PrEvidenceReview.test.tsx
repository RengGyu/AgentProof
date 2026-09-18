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
});
