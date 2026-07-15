import type { DecisionCard, EvidenceItem, PriorityLevel, ProofGapKind, VerificationReport } from "./types";

const SEVERITY_RANK: Record<PriorityLevel, number> = { blocker: 0, high: 1, medium: 2, low: 3 };
const KIND_RANK: Record<ProofGapKind, number> = {
  failed_execution: 0,
  missing_execution: 1,
  missing_targeted_test: 2,
  missing_implementation: 3,
  ambiguous_requirement: 4,
  evidence_unavailable: 5,
  visual_proof_missing: 6,
  self_reported_test_gap: 7
};

interface RankedGap {
  gapKey: string;
  requirementId: string | null;
  kind: ProofGapKind;
  severity: PriorityLevel;
  summary: string;
  evidenceRefs: string[];
}

export function buildDecisionCard(report: VerificationReport): DecisionCard {
  const topGap = rankGaps(report)[0] ?? null;
  const firstInspectionPoints = buildInspectionPoints(report, topGap?.evidenceRefs ?? []);

  return {
    version: 1,
    topGap: topGap ? { ...topGap, requirementId: topGap.requirementId } : null,
    testBuildStatus: report.testing.ciStatus,
    firstInspectionPoints,
    reprompt: topGap ? {
      gapKey: topGap.gapKey,
      basedOnGapKind: topGap.kind,
      evidenceRefs: [...topGap.evidenceRefs],
      prompt: buildGapReprompt(topGap, firstInspectionPoints)
    } : null
  };
}

function rankGaps(report: VerificationReport): RankedGap[] {
  const evidenceIds = new Set(report.evidenceIndex.map((item) => item.id));
  const gaps = report.proofGraph.nodes.flatMap((node) =>
    node.gapSignals.map((gap) => {
      const evidenceRefs = [...new Set(gap.evidenceRefs)].filter((ref) => evidenceIds.has(ref)).sort();
      const requirementId = gap.kind === "failed_execution" ? null : node.requirementId;
      return ({
      gapKey: `${requirementId ?? "report"}:${gap.kind}:${evidenceRefs.join("+")}`,
      requirementId,
      kind: gap.kind,
      severity: gap.severity,
      summary: gap.message,
      evidenceRefs
    }); })
  ).filter((gap) => gap.evidenceRefs.length > 0);
  const uniqueGaps = [...new Map(gaps.map((gap) => [gap.gapKey, gap])).values()];

  return uniqueGaps.sort((left, right) =>
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || KIND_RANK[left.kind] - KIND_RANK[right.kind]
    || left.summary.localeCompare(right.summary)
    || left.evidenceRefs.join("\0").localeCompare(right.evidenceRefs.join("\0"))
    || (left.requirementId ?? "").localeCompare(right.requirementId ?? "")
  );
}

function buildInspectionPoints(report: VerificationReport, preferredRefs: string[]): DecisionCard["firstInspectionPoints"] {
  const evidenceById = new Map(report.evidenceIndex.map((item) => [item.id, item]));
  const orderedRefs = [...new Set([
    ...preferredRefs,
    ...report.reviewPriority.flatMap((item) => item.evidenceRefs ?? []),
    ...report.evidenceIndex.map((item) => item.id)
  ])];
  const points: DecisionCard["firstInspectionPoints"] = [];

  for (const ref of orderedRefs) {
    const item = evidenceById.get(ref);
    if (!item) continue;
    const point = inspectionPoint(report, item, ref);
    if (!point || points.some((existing) => existing.href === point.href)) continue;
    points.push(point);
    if (points.length === 2) break;
  }

  return points;
}

function inspectionPoint(report: VerificationReport, item: EvidenceItem, evidenceRef: string): DecisionCard["firstInspectionPoints"][number] | null {
  const direct = safeGitHubUrl(item.locator);
  if ((item.kind === "check" || item.kind === "log" || item.kind === "test") && direct && sameGitHubRepository(report.source.url, direct)) {
    return { kind: "check", label: item.label, href: direct, evidenceRefs: [evidenceRef] };
  }

  if (item.kind !== "changed_file" && item.kind !== "diff" && item.kind !== "test") return null;
  const path = item.locator ?? item.label;
  const href = githubFileUrl(report, path);
  return href ? { kind: "file", label: path, href, evidenceRefs: [evidenceRef] } : null;
}

function sameGitHubRepository(sourceValue: string | undefined, targetValue: string): boolean {
  const source = safeGitHubUrl(sourceValue);
  if (!source) return false;
  const sourceParts = new URL(source).pathname.split("/").filter(Boolean).slice(0, 2).map((part) => part.toLowerCase());
  const targetParts = new URL(targetValue).pathname.split("/").filter(Boolean).slice(0, 2).map((part) => part.toLowerCase());
  return sourceParts.length === 2 && sourceParts.join("/") === targetParts.join("/");
}

function githubFileUrl(report: VerificationReport, path: string): string | null {
  const source = safeGitHubUrl(report.source.url);
  const headSha = report.source.provenance?.headSha;
  const segments = path.split("/");
  if (!source || !headSha || !/^[a-f0-9]{6,64}$/.test(headSha) || segments.some((segment) => !segment || segment === "." || segment === "..") || path.includes("\\") || /^[a-z]+:/i.test(path)) return null;
  const match = source.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+\/?$/i);
  if (!match) return null;
  return `https://github.com/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/blob/${headSha}/${segments.map(encodeURIComponent).join("/")}`;
}

function safeGitHubUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function buildGapReprompt(gap: RankedGap, points: DecisionCard["firstInspectionPoints"]): string {
  const gapPoints = points.filter((point) => point.evidenceRefs.every((ref) => gap.evidenceRefs.includes(ref)));
  const inspect = gapPoints.map((point) => point.label).join(", ") || "the cited evidence references";
  const action = gap.kind === "missing_execution" || gap.kind === "failed_execution"
    ? "Run the exact cited test/build target and report its observable pass/fail result."
    : gap.kind === "missing_targeted_test" || gap.kind === "self_reported_test_gap"
      ? "Add the smallest targeted test for the named requirement, then report its observable pass/fail result."
      : gap.kind === "ambiguous_requirement"
        ? "Clarify one authoritative acceptance criterion before changing code."
        : gap.kind === "evidence_unavailable" || gap.kind === "visual_proof_missing"
          ? "Collect the specifically cited missing evidence without claiming the behavior passed."
          : "Make the smallest implementation change tied only to this requirement, then add targeted proof.";
  return [
    gap.requirementId
      ? `Close the deterministic proof gap for requirement ${gap.requirementId}: ${gap.summary}`
      : `Investigate the report-level deterministic execution gap: ${gap.summary}`,
    `Inspect ${inspect}.`,
    action,
    `Keep the evidence references ${gap.evidenceRefs.join(", ") || "attached to this gap"}; do not claim correctness or merge readiness.`
  ].join("\n");
}
