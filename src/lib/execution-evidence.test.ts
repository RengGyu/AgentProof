import { describe, expect, it } from "vitest";
import {
  getExecutionEvidenceItems,
  isExecutionEvidenceItem,
  statusFromEvidenceSummary
} from "./execution-evidence";
import type { EvidenceItem } from "./types";

describe("getExecutionEvidenceItems", () => {
  it("keeps only test/build check and log evidence, ordered by review urgency", () => {
    const evidenceIndex: EvidenceItem[] = [
      {
        id: "ev_preview",
        kind: "check",
        label: "Vercel Preview tests",
        summary: "Status: passed. Vercel Preview deployment completed after smoke tests",
        confidence: 0.9
      },
      {
        id: "ev_unit_passed",
        kind: "check",
        label: "unit tests",
        summary: "Status: passed. unit tests - auth specs passed",
        confidence: 0.92
      },
      {
        id: "ev_security",
        kind: "check",
        label: "security coverage scan",
        summary: "Status: failed. coverage policy found a finding",
        confidence: 0.88
      },
      {
        id: "ev_unit_failed",
        kind: "log",
        label: "vitest",
        summary: "Status: failed. vitest: expected inline error to be visible",
        confidence: 0.95
      },
      {
        id: "ev_build_unknown",
        kind: "check",
        label: "build",
        summary: "Build job did not publish a status prefix",
        confidence: 0.7
      },
      {
        id: "ev_e2e_pending",
        kind: "check",
        label: "playwright e2e",
        summary: "Status: pending. playwright e2e still running",
        confidence: 0.8
      },
      {
        id: "ev_diff",
        kind: "diff",
        label: "src/app.ts",
        summary: "modified src/app.ts",
        confidence: 0.85
      }
    ];

    expect(getExecutionEvidenceItems(evidenceIndex).map((item) => item.id)).toEqual([
      "ev_unit_failed",
      "ev_e2e_pending",
      "ev_build_unknown",
      "ev_unit_passed"
    ]);
    expect(isExecutionEvidenceItem(evidenceIndex[0])).toBe(false);
    expect(isExecutionEvidenceItem(evidenceIndex[2])).toBe(false);
    expect(isExecutionEvidenceItem(evidenceIndex[6])).toBe(false);
  });

  it("parses known status prefixes without trusting unrelated text", () => {
    expect(statusFromEvidenceSummary("Status: passed. unit tests passed")).toBe("passed");
    expect(statusFromEvidenceSummary("Status: failed. unit tests failed")).toBe("failed");
    expect(statusFromEvidenceSummary("Status: pending. build still running")).toBe("pending");
    expect(statusFromEvidenceSummary("Status: unknown. no CI log")).toBe("unknown");
    expect(statusFromEvidenceSummary("all good, probably passed")).toBe("unknown");
  });

  it("does not reject real execution checks because a locator URL contains gate words", () => {
    const evidenceIndex: EvidenceItem[] = [
      {
        id: "ev_unit",
        kind: "check",
        label: "unit tests",
        locator: "https://github.com/acme/security-preview-app/actions/runs/123",
        summary: "Status: passed. unit tests completed",
        confidence: 0.9
      }
    ];

    expect(getExecutionEvidenceItems(evidenceIndex).map((item) => item.id)).toEqual(["ev_unit"]);
  });

  it("does not promote generic CI checks when only the summary mentions preview or report tests", () => {
    const evidenceIndex: EvidenceItem[] = [
      {
        id: "ev_preview_summary",
        kind: "check",
        label: "CI",
        summary: "Status: passed. Vercel Preview tests passed after deployment",
        confidence: 0.9
      },
      {
        id: "ev_report_summary",
        kind: "check",
        label: "build",
        summary: "Status: passed. security coverage tests report published",
        confidence: 0.9
      },
      {
        id: "ev_actual_step",
        kind: "log",
        label: "GitHub Actions job: CI",
        summary: "Status: passed. GitHub Actions job CI: passed. Steps: pnpm test: passed",
        confidence: 0.75
      }
    ];

    expect(getExecutionEvidenceItems(evidenceIndex).map((item) => item.id)).toEqual(["ev_actual_step"]);
  });
});
