import type { RequirementStatus } from "./types";

/** Source-derived obligations, not a complete typed contract or whole-PR verdict. */
export interface OrdinaryRequirementOutcomes {
  version: 1;
  scope: "selected_source_requirements";
  requirements: Array<{
    requirementId: string;
    authority: "authoritative" | "author_claim";
    interpretation: "source_explicit" | "unavailable";
    criterion: null | {
      criterionId: string;
      kind: "documentation_literal" | "typescript_union_member" | "standalone_scalar" | "typescript_assignability";
      state: "satisfied" | "violated" | "unavailable";
      evidenceRefs: string[];
    };
    reason: "source_interpretation_unavailable" | "evidence_unavailable" | "criterion_satisfied" | "criterion_violated";
  }>;
}
export type OrdinaryRequirementOutcome = OrdinaryRequirementOutcomes["requirements"][number];

export function ordinaryRequirementStatus(row: OrdinaryRequirementOutcome): RequirementStatus {
  if (row.interpretation !== "source_explicit" || !row.criterion || row.criterion.state === "unavailable") return "unclear";
  if (row.criterion.state === "violated") return "missing";
  return row.authority === "author_claim" ? "partial" : "met";
}

export function isOrdinaryRequirementOutcomes(value: unknown): value is OrdinaryRequirementOutcomes {
  if (!record(value) || !keys(value, ["version", "scope", "requirements"]) || value.version !== 1 || value.scope !== "selected_source_requirements" || !Array.isArray(value.requirements) || value.requirements.length > 100) return false;
  const ids = new Set<string>();
  return value.requirements.every(row => {
    if (!record(row) || !keys(row, ["requirementId", "authority", "interpretation", "criterion", "reason"]) || typeof row.requirementId !== "string" || !/^req_[1-9]\d*$/.test(row.requirementId) || ids.has(row.requirementId) || !["authoritative", "author_claim"].includes(String(row.authority))) return false;
    ids.add(row.requirementId);
    if (row.interpretation === "unavailable") return row.criterion === null && row.reason === "source_interpretation_unavailable";
    const c = row.criterion;
    return row.interpretation === "source_explicit" && record(c) && keys(c, ["criterionId", "kind", "state", "evidenceRefs"]) && c.criterionId === `${row.requirementId}_c1` && ["documentation_literal", "typescript_union_member", "standalone_scalar", "typescript_assignability"].includes(String(c.kind)) && ["satisfied", "violated", "unavailable"].includes(String(c.state)) && Array.isArray(c.evidenceRefs) && c.evidenceRefs.length <= 1 && c.evidenceRefs.every(ref => typeof ref === "string" && /^ev_[A-Za-z0-9_]+$/.test(ref)) && row.reason === (c.state === "satisfied" ? "criterion_satisfied" : c.state === "violated" ? "criterion_violated" : "evidence_unavailable");
  });
}

/** Same closure check for generated, signed and portable projections. */
export function ordinaryRequirementOutcomeErrors(value: unknown, requirements: readonly { requirementId: string; status: RequirementStatus; evidenceRefs?: readonly string[] }[], evidenceIds?: ReadonlySet<string>, allowOmittedEvidence = false): string[] {
  if (!isOrdinaryRequirementOutcomes(value)) return ["Invalid source-derived requirement outcomes."];
  if (value.requirements.length !== requirements.length || value.requirements.some((row, index) => row.requirementId !== requirements[index]?.requirementId || ordinaryRequirementStatus(row) !== requirements[index]?.status)) return ["Source-derived outcomes must cover canonical requirements and determine their status."];
  if (value.requirements.some((row, index) => row.criterion && ((row.criterion.state !== "unavailable" && !allowOmittedEvidence && row.criterion.evidenceRefs.length !== 1) || row.criterion.evidenceRefs.some(ref => !evidenceIds?.has(ref) || !requirements[index].evidenceRefs?.includes(ref))))) return ["Source-derived outcomes require matching artifact evidence references."];
  return [];
}

export function copyOrdinaryRequirementOutcomes(value: OrdinaryRequirementOutcomes, omitEvidence = false): OrdinaryRequirementOutcomes {
  if (!isOrdinaryRequirementOutcomes(value)) throw new Error("Invalid source-derived requirement outcomes.");
  return { version: 1, scope: "selected_source_requirements", requirements: value.requirements.map(row => ({ ...row, criterion: row.criterion ? { ...row.criterion, evidenceRefs: omitEvidence ? [] : [...row.criterion.evidenceRefs] } : null })) };
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: string[]): boolean { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
