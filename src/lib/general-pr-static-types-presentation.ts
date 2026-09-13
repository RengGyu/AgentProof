/** Public counts only: source operands and artifact bindings remain private. */
export interface OrdinaryStaticSummary {
  version: 1;
  scope: "direct_union_membership_only";
  interpretation: "hypothesis";
  lookupScope: "changed_files_only";
  lookupIncomplete: boolean;
  predicates: Array<{ sourceKind: "linked_issue" | "pr_body" | "pr_title" | "provided_requirement"; sourceOrdinal: number; artifactCounts: { present: number; absent: number; unavailable: number } }>;
}
export function isOrdinaryStaticSummary(value: unknown): value is OrdinaryStaticSummary {
  if (!record(value) || !keys(value, ["version", "scope", "interpretation", "lookupScope", "lookupIncomplete", "predicates"]) || value.version !== 1 || value.scope !== "direct_union_membership_only" || value.interpretation !== "hypothesis" || value.lookupScope !== "changed_files_only" || typeof value.lookupIncomplete !== "boolean" || !Array.isArray(value.predicates) || value.predicates.length < 1 || value.predicates.length > 8) return false;
  let total: number | undefined;
  for (const item of value.predicates) {
    if (!record(item) || !keys(item, ["sourceKind", "sourceOrdinal", "artifactCounts"]) || typeof item.sourceKind !== "string" || !["linked_issue", "pr_body", "pr_title", "provided_requirement"].includes(item.sourceKind) || !Number.isSafeInteger(item.sourceOrdinal) || Number(item.sourceOrdinal) < 1 || Number(item.sourceOrdinal) > 10000 || !record(item.artifactCounts) || !keys(item.artifactCounts, ["present", "absent", "unavailable"])) return false;
    const counts = Object.values(item.artifactCounts);
    if (!counts.every(count => Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 8)) return false;
    const sum = counts.reduce<number>((sum, count) => sum + Number(count), 0);
    if (sum < 1 || sum > 8 || (total !== undefined && sum !== total)) return false;
    total = sum;
  }
  return true;
}
export function copyOrdinaryStaticSummary(value: OrdinaryStaticSummary): OrdinaryStaticSummary {
  if (!isOrdinaryStaticSummary(value)) throw new Error("Invalid scoped static summary.");
  return { version: 1, scope: "direct_union_membership_only", interpretation: "hypothesis", lookupScope: "changed_files_only", lookupIncomplete: value.lookupIncomplete, predicates: value.predicates.map(({ sourceKind, sourceOrdinal, artifactCounts }) => ({ sourceKind, sourceOrdinal, artifactCounts: { present: artifactCounts.present, absent: artifactCounts.absent, unavailable: artifactCounts.unavailable } })) };
}
export function presentOrdinaryStaticSummary(value: OrdinaryStaticSummary): string[] {
  return value.predicates.map(item => `${item.sourceKind.replaceAll("_", " ")} source item ${item.sourceOrdinal}: direct union membership — artifact checks: ${item.artifactCounts.present} present, ${item.artifactCounts.absent} absent, ${item.artifactCounts.unavailable} unavailable; source interpretation needs reviewer confirmation; changed-files-only lookup${value.lookupIncomplete ? " (incomplete)" : ""}; not whole-goal or PR verification.`);
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: string[]): boolean { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
