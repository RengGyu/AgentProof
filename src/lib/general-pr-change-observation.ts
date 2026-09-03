import { createHash } from "node:crypto";
import type { ChangedFile } from "./types";

export interface GeneralPrChangeFactV2 {
  fileRef: string;
  status: "added" | "modified" | "removed" | "renamed" | "unknown";
  roleCandidates: Array<"source" | "test" | "documentation" | "configuration" | "schema" | "migration" | "generated" | "dependency" | "workflow" | "unknown">;
  language: string | null;
  completeness: "complete" | "incomplete" | "unknown";
}

export interface GeneralPrChangeClusterV2 {
  version: 2;
  id: string;
  fileRefs: string[];
  formationBasis: "exact_path" | "rename" | "static_relation" | "build_relation" | "singleton";
}

export interface GeneralPrReleasedChangeRelationV2 {
  kind: "static_relation" | "build_relation";
  fileRefs: string[];
  receiptDigest: string;
}

export interface GeneralPrChangeObservationOptionsV2 {
  inventoryCompleteness?: "complete" | "incomplete" | "unknown";
  releasedRelations?: GeneralPrReleasedChangeRelationV2[];
}

export interface GeneralPrChangeObservationV2 {
  version: 2;
  facts: GeneralPrChangeFactV2[];
  clusters: GeneralPrChangeClusterV2[];
}

/**
 * This layer records only deterministic file facts. It has no requirement,
 * behavioral-impact, or test-required decision because those need later proof.
 */
export function buildGeneralPrChangeObservationV2(
  changedFiles: ChangedFile[],
  options: GeneralPrChangeObservationOptionsV2 = {}
): GeneralPrChangeObservationV2 {
  const completeness = options.inventoryCompleteness ?? "unknown";
  const facts = changedFiles.map((file) => toFact(file, completeness));
  const clusters = buildClusters(facts, options.releasedRelations ?? []);
  return { version: 2, facts, clusters };
}

function toFact(file: ChangedFile, inventoryCompleteness: NonNullable<GeneralPrChangeObservationOptionsV2["inventoryCompleteness"]>): GeneralPrChangeFactV2 {
  const path = file.path.replace(/\\/g, "/");
  return {
    fileRef: `gpcf_${digest({ domain: "agentproof.general-pr.file.v2", path, previousPath: file.previousPath ?? null }).slice(0, 24)}`,
    status: file.status ?? "unknown",
    roleCandidates: roleCandidates(path),
    language: languageForPath(path),
    completeness: inventoryCompleteness
  };
}

function buildClusters(facts: GeneralPrChangeFactV2[], relations: GeneralPrReleasedChangeRelationV2[]): GeneralPrChangeClusterV2[] {
  const available = new Set(facts.map((fact) => fact.fileRef));
  const accepted = relations.filter((relation) => (
    isReleasedRelation(relation) && relation.fileRefs.length > 1 && relation.fileRefs.every((fileRef) => available.has(fileRef))
  ));
  const assigned = new Set<string>();
  const clusters: GeneralPrChangeClusterV2[] = [];
  for (const relation of accepted) {
    if (relation.fileRefs.some((fileRef) => assigned.has(fileRef))) continue;
    relation.fileRefs.forEach((fileRef) => assigned.add(fileRef));
    clusters.push(cluster(relation.fileRefs, relation.kind));
  }
  for (const fact of facts) {
    if (assigned.has(fact.fileRef)) continue;
    clusters.push(cluster([fact.fileRef], fact.status === "renamed" ? "rename" : "singleton"));
  }
  return clusters;
}

function cluster(fileRefs: string[], formationBasis: GeneralPrChangeClusterV2["formationBasis"]): GeneralPrChangeClusterV2 {
  return {
    version: 2,
    id: `gpcl_${digest({ domain: "agentproof.general-pr.cluster.v2", fileRefs, formationBasis }).slice(0, 24)}`,
    fileRefs: [...fileRefs],
    formationBasis
  };
}

function roleCandidates(path: string): GeneralPrChangeFactV2["roleCandidates"] {
  const name = path.toLowerCase();
  if (/(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[a-z0-9]+$/.test(name)) return ["test"];
  if (/(^|\/)(docs?|documentation)\//.test(name) || /\.mdx?$/.test(name)) return ["documentation"];
  if (/\.ya?ml$/.test(name) && name.includes(".github/workflows/")) return ["workflow", "configuration"];
  if (/(^|\/)(migrations?|db)\//.test(name)) return ["migration", "schema"];
  if (/(^|\/)(generated|dist|build)\//.test(name)) return ["generated"];
  if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|cargo\.lock)$/.test(name)) return ["dependency"];
  if (/\.(json|ya?ml|toml|ini|config\.[a-z0-9]+)$/.test(name)) return ["configuration"];
  return ["source"];
}

function languageForPath(path: string): string | null {
  const extension = path.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin", rb: "ruby", cs: "csharp" };
  return extension ? languages[extension] ?? null : null;
}

function isReleasedRelation(value: GeneralPrReleasedChangeRelationV2): boolean {
  return (value.kind === "static_relation" || value.kind === "build_relation") && Array.isArray(value.fileRefs) && new Set(value.fileRefs).size === value.fileRefs.length && value.fileRefs.every((fileRef) => typeof fileRef === "string") && /^[a-f0-9]{64}$/.test(value.receiptDigest);
}
function digest(value: unknown): string { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`; } return JSON.stringify(value); }
