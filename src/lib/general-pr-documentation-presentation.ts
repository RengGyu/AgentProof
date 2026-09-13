/** Safe fixed vocabulary; never carries source text, literals, or private bindings. */
export interface OrdinaryDocumentationSummary {
  version: 1;
  scope: "literal_presence_only";
  predicates: Array<{ sourceKind: "linked_issue" | "pr_body" | "pr_title" | "provided_requirement"; sourceOrdinal: number; legacyRequirementId: string | null; state: "supported" | "contradicted" | "unavailable" }>;
}

export function isOrdinaryDocumentationSummary(value: unknown): value is OrdinaryDocumentationSummary {
  if (!record(value) || !keys(value, ["version", "scope", "predicates"]) || value.version !== 1 || value.scope !== "literal_presence_only" || !Array.isArray(value.predicates) || value.predicates.length < 1 || value.predicates.length > 8) return false;
  return value.predicates.every(item => record(item) && keys(item, ["sourceKind", "sourceOrdinal", "legacyRequirementId", "state"]) && ["linked_issue", "pr_body", "pr_title", "provided_requirement"].includes(String(item.sourceKind)) && Number.isSafeInteger(item.sourceOrdinal) && Number(item.sourceOrdinal) > 0 && (item.legacyRequirementId === null || (typeof item.legacyRequirementId === "string" && /^req_\d+$/.test(item.legacyRequirementId))) && ["supported", "contradicted", "unavailable"].includes(String(item.state)));
}
export function copyOrdinaryDocumentationSummary(value: OrdinaryDocumentationSummary): OrdinaryDocumentationSummary {
  if (!isOrdinaryDocumentationSummary(value)) throw new Error("Invalid scoped documentation summary.");
  return { version: 1, scope: "literal_presence_only", predicates: value.predicates.map(({ sourceKind, sourceOrdinal, legacyRequirementId, state }) => ({ sourceKind, sourceOrdinal, legacyRequirementId, state })) };
}
export function presentOrdinaryDocumentationSummary(value: OrdinaryDocumentationSummary): string[] {
  return value.predicates.map(item => `${item.sourceKind.replaceAll("_", " ")} source item ${item.sourceOrdinal}${item.legacyRequirementId ? ` (${item.legacyRequirementId})` : ""}: ${item.state === "supported" ? "literal present" : item.state === "contradicted" ? "literal absent after complete artifact read" : "exact-head artifact unavailable"}. Literal-presence predicate only; not whole-goal or PR verification${item.sourceKind.startsWith("pr_") ? "; author claim needs reviewer confirmation" : ""}.`);
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: string[]): boolean { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
