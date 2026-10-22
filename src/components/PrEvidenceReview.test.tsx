import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrEvidenceReview } from "./PrEvidenceReview";

describe("PrEvidenceReview", () => {
  it("renders purpose fit per clause without remaining-question or collection-limit checklists", () => {
    const quote = { basis: "source_text", text: "keep_queue()", evidenceRefs: ["pe_a"] };
    const clause = (clauseId: string, purpose: string, observations: any[]) => ({ clauseId, purpose, implementation: "supports", testRelation: "unknown", evidenceRefs: observations.length ? ["pe_a"] : [], counterEvidenceRefs: [], changeObservations: observations, testObservations: [], remainingQuestions: [{ text: "Was the caller read?", evidenceRefs: [] }] });
    const result = (clauseId: string, implementation: string) => ({ clauseId, implementation, testRelation: "unknown", execution: "not_observed", evidenceRefs: [], counterEvidenceRefs: [], openQuestions: ["Was the caller read?"], reasonCodes: [], criterionEvidenceRefs: [] });
    const review: any = { mode: "objectives", source: null, changes: [], nextInspection: "Inspect evidence.", objectives: [],
      purpose: { version: 1, flow: "explore_final_v1", scope: "stated_purpose_at_snapshot", state: "limited", overall: "partial", goals: [], limitations: ["localization_partial"] },
      purposeFacts: { version: 1, scope: "stated_purpose_at_snapshot", state: "limited", overall: "partial", limitations: ["localization_partial"], traceDigest: "t", subjectDigest: "s",
        evidenceIndex: [{ id: "pe_a", path: "src/work.py", side: "head", revision: "a".repeat(40), startLine: 1, endLine: 2 }],
        goals: [{ goalId: "pg_a", authority: "author_claim", achievement: "partial", assurance: "evidence_assessed", clauseResults: [result("pc_fit", "supports"), result("pc_none", "unknown")] }],
        facts: { version: 1, coverage: { omittedEvidence: [{ id: "pe_x" }], readOutcomes: [{ outcome: "unavailable" }], omittedToolResults: [] },
          clauses: [clause("pc_fit", "Keep queued work", [quote]), clause("pc_none", "Report metrics", [])] } } };
    const html = renderToStaticMarkup(<PrEvidenceReview review={review} />);
    expect(html).toContain("Changed material fits this purpose item.");
    expect(html).toContain("Not confirmed from the selected changed source.");
    expect(html).toContain("keep_queue()");
    expect(html).toContain("Judgments cover only the cited changed source.");
    expect(html).not.toMatch(/Test meaning|No test interpretation|<h5>Execution|not observed|not required/);
    expect(html).toContain("src/work.py:1-2");
    expect(html).toContain("a".repeat(40));
    review.purposeFacts.facts.clauses[0].testObservations=[quote];
    Object.assign(review.purposeFacts.goals[0].clauseResults[0],{execution:"checked_pass",criterionEvidenceRefs:["pe_a"],reasonCodes:["source_owned_execution_result"]});
    const executed=renderToStaticMarkup(<PrEvidenceReview review={review}/>);
    expect(executed.match(/<h5>Test meaning/g)).toHaveLength(1);
    expect(executed.match(/<h5>Execution/g)).toHaveLength(1);
    expect(executed).toContain("checked pass");
    expect(executed.match(/reading source does not verify behavior or test execution/g)).toHaveLength(1);
    expect(html).not.toMatch(/Remaining questions|Was the caller read\?|Collection limits|Omitted source candidates|unavailable or rejected reads/);
  });
  it("opens only the first objective while keeping other objectives available as disclosures", () => {
    const review = { mode: "objectives" as const, source: null, changes: [], nextInspection: "Inspect evidence.", objectives: ["First goal", "Second goal"].map((text, i) => ({ id: `goal-${i}`, text, code: [], tests: [], execution: [], nextInspection: "Review evidence." })) };
    const before = JSON.stringify(review);
    const html = renderToStaticMarkup(<PrEvidenceReview review={review} />);
    expect(html.match(/<details class="pr-evidence-objective"/g)).toHaveLength(2);
    expect(html.match(/<details class="pr-evidence-objective" open=""/g)).toHaveLength(1);
    expect(html).toContain("Second goal");
    expect(JSON.stringify(review)).toBe(before);
  });
  it("omits internal goal provenance without changing the review model or its uncertainty", () => {
    const review = {
      mode: "objectives" as const, source: { kind: "pr_author_claim" as const, label: "PR author claim", authority: "author_claim" as const }, changes: [], nextInspection: "Inspect code.",
      objectives: [{ id: "goal", text: "Handle expired links.", goalContext: ["internal claim context"], sourceRefs: [{ start: 11, end: 25, hash: "a".repeat(64) }], facets: [{ kind: "test_claim", sourceRef: { start: 11, end: 25, hash: "a".repeat(64) } }], code: [{ evidenceId: "code", kind: "code" as const, label: "src/reset.ts", relation: "candidate" as const, uncertainty: "Execution has not been checked." }], tests: [], execution: [], nextInspection: "Inspect code." }]
    };
    const before = JSON.stringify(review);
    const html = renderToStaticMarkup(<PrEvidenceReview review={review} />);
    expect(html).not.toMatch(/Goal details|Source offsets|Source:|internal claim context|test claim/);
    expect(html).toContain("Execution has not been checked.");
    expect(JSON.stringify(review)).toBe(before);
  });
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
    expect(html).not.toContain("Linked issue requirement source");
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
    expect(html).not.toMatch(/<details class="muted small"[^>]*open/);
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
  describe("saved purpose review", () => {
    const head = "5".repeat(40);
    const clause = (n: number, extra: Record<string, unknown> = {}) => ({ clauseId: `pc_${n}`, goalId: "pg_1", purpose: `Purpose text ${n}`, implementation: "supports",
      changeDescriptions: [{ text: `Lead change ${n}.`, evidenceRefs: ["pe_a"] }], testDescriptions: [], ...extra });
    const review = (clauses: unknown[]): any => ({ mode: "change_summary", source: null, changes: [], nextInspection: "Inspect evidence.", objectives: [], repositoryFullName: "owner/repo",
      purpose: { version: 1, flow: "explore_final_v1", scope: "stated_purpose_at_snapshot", state: "limited", overall: "partial", goals: [{ goalId: "pg_1", authority: "author_claim" }], limitations: [] },
      purposeReview: { version: 1, flow: "explore_final_v1", headSha: head, baseSha: "6".repeat(40), clauses,
        references: [{ id: "pe_a", path: "README.md", side: "head", revision: head, startLine: 109, endLine: 116 }, { id: "pe_b", path: "tests/readme.test.ts", side: "head", revision: head, startLine: 3, endLine: 9 }] } });
    const rich = clause(1, { conditions: ["Execution status needs recorded check or log evidence."], exceptions: ["Docs-only runs"],
      changeDescriptions: [{ text: "Lead change 1.", evidenceRefs: ["pe_a"] }, { text: "Second change 1.", evidenceRefs: ["pe_a"] }],
      testDescriptions: [{ text: "The assertion reads the README.", evidenceRefs: ["pe_b"] }] });

    it("keeps saved changes first and preserves conditions and tests in details with exact links", () => {
      const html = renderToStaticMarkup(<PrEvidenceReview review={review([rich])} />);
      for (const text of ['<h3>Purpose text 1</h3>','Lead change 1.','Second change 1.','The assertion reads the README.','Execution status needs recorded check or log evidence.','Docs-only runs',`https://github.com/owner/repo/blob/${head}/README.md#L109-L116`,'Path'])expect(html).toContain(text);
      const main=html.split('<details class="report-purpose-details">')[0];expect(main).toContain('Lead change 1.');expect(main).not.toContain('Docs-only runs');expect(html.indexOf('The assertion reads the README.')).toBeGreaterThan(html.indexOf('report-purpose-details'));
      expect(html).not.toMatch(/Individual test execution lists are not retained|Author claim|Show full revisions|Stated intent details|model interpretations, not verified|These interpretations cover/);
    });

    it("leaves purposes to the summary above while keeping other collected changes", () => {
      const withChanges = { ...review([rich, clause(2)]), changes: [{ evidenceId: "ev_1", kind: "code", label: "src/other.ts", relation: "collected" }] };
      const html = renderToStaticMarkup(<PrEvidenceReview review={withChanges} leadInSummary />);
      expect(html).not.toMatch(/Purpose evidence|Purpose text|Lead change|Execution status needs|purpose-revisions/);
      expect(html).toContain("Collected changes (1)");
    });

    it("keeps location-only and test-only purposes distinguishable on their own", () => {
      const locationOnly = renderToStaticMarkup(<PrEvidenceReview review={review([clause(1, { implementation: "unknown", changeDescriptions: [], evidenceRefs: ["pe_a", "pe_b"] })])} />);
      expect(locationOnly).toContain("Selected change locations");
      expect(locationOnly).toContain("readme.test.ts:3-9");expect(locationOnly).toContain("tests/readme.test.ts, after change, lines 3-9");
      const testOnly = renderToStaticMarkup(<PrEvidenceReview review={review([clause(1, { changeDescriptions: [], testDescriptions: [{ text: "The static assertion checks retained work; execution is not established.", evidenceRefs: ["pe_a"] }] })])} />);
      expect(testOnly).toContain('Static tests');expect(testOnly).toContain('The static assertion checks retained work; execution is not established.');
    });

    it("labels a Korean report in Korean without changing its model text or references", () => {
      const ko = { ...review([clause(1, { purpose: "대기 중인 작업 유지", changeDescriptions: [{ text: "변경된 소스는 대기 중인 작업을 유지합니다.", evidenceRefs: ["pe_a"] }] })]) };
      ko.purposeReview.locale = "ko";
      const html = renderToStaticMarkup(<PrEvidenceReview review={ko} />);
      for(const text of ['lang="ko"','변경 요약','대기 중인 작업 유지','적합','<h4>변경</h4>','변경된 소스는 대기 중인 작업을 유지합니다.','GitHub에서 열기','README.md:109-116'])expect(html).toContain(text);
      expect(html).not.toMatch(/Purpose evidence|Model interpretation|Changed material fits|작성자 주장|전체 리비전|작성자 의도 기준|변경 의도와 맞음/);
    });
  });
});
