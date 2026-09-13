import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateTypeScriptUnionMember, type TypeScriptUnionMemberTarget } from "./typescript-union-verification";

const target: TypeScriptUnionMemberTarget = { path: "src/types.ts", aliasName: "Result", member: "undefined", headSha: "a".repeat(40) };
const blob = (content: string) => ({ path: target.path, headSha: target.headSha, content });

describe("TypeScript direct union-member verification", () => {
  it("uses real union nodes and keeps only bounded private evidence metadata", () => {
    const artifact = blob("namespace API { export type Result = ((string | number) | (undefined)); }");
    const result = evaluateTypeScriptUnionMember(target, [artifact]);
    expect(result).toEqual({ path: target.path, headSha: target.headSha, artifactDigest: createHash("sha256").update(artifact.content).digest("hex"), state: "supported", reason: "member_present" });
    expect(evaluateTypeScriptUnionMember({ ...target, aliasName: "API.Result" }, [artifact]).state).toBe("supported");
    expect(JSON.stringify(result)).not.toMatch(/namespace|export|Result|content/);
  });

  it("changes supported to contradicted when the direct member is removed", () => {
    expect(evaluateTypeScriptUnionMember(target, [blob("type Result = string | undefined | number;")]).state).toBe("supported");
    expect(evaluateTypeScriptUnionMember(target, [blob("type Result = string | number;")])).toMatchObject({ state: "contradicted", reason: "member_absent" });
    expect(evaluateTypeScriptUnionMember({ ...target, member: "null" }, [blob("type Result = string | null;")]).state).toBe("supported");
  });

  it.each([
    ["// undefined\ntype Result = string | number; type Other = string | undefined;", "contradicted"],
    ["type Result = string | 'undefined';", "unavailable"],
    ["type Result = string | { value: undefined };", "unavailable"],
    ["type Other = undefined; type Result = string | Other;", "unavailable"]
  ])("never treats text or a nested/transitive member as direct membership: %s", (content, state) => {
    expect(evaluateTypeScriptUnionMember(target, [blob(content)]).state).toBe(state);
  });

  it("requires a unique alias and honors an explicit namespace path", () => {
    const artifact = blob("namespace A { type Result = string | undefined; } namespace B { type Result = string | number; }");
    expect(evaluateTypeScriptUnionMember(target, [artifact])).toMatchObject({ state: "unavailable", reason: "alias_ambiguous" });
    expect(evaluateTypeScriptUnionMember({ ...target, aliasName: "B.Result" }, [artifact]).state).toBe("contradicted");
    expect(evaluateTypeScriptUnionMember(target, [blob("function f() { type Result = string | undefined; }")])).toMatchObject({ state: "unavailable", reason: "alias_missing" });
  });

  it.each([
    ["type Result = string | undefined; const broken = ;", "syntax_invalid"],
    ["type Result<T> = string | undefined;", "unsupported_alias"],
    ["type Result = string extends unknown ? undefined : number;", "unsupported_alias"],
    ["type Result = undefined;", "unsupported_alias"]
  ])("abstains on malformed files and unsupported declarations: %s", (content, reason) => {
    expect(evaluateTypeScriptUnionMember(target, [blob(content)])).toMatchObject({ state: "unavailable", reason });
  });

  it("requires one exact-head bounded artifact and rejects unsafe targets", () => {
    const artifact = blob("type Result = string | undefined;");
    for (const artifacts of [[], [artifact, artifact], [{ ...artifact, headSha: "b".repeat(40) }], [{ ...artifact, path: "other.ts" }], Array(9).fill(artifact)]) {
      expect(evaluateTypeScriptUnionMember(target, artifacts)).toMatchObject({ state: "unavailable", reason: "artifact_unavailable", artifactDigest: null });
    }
    for (const patch of [{ path: "../types.ts" }, { path: "/types.ts" }, { path: "src/types.js" }, { aliasName: "API..Result" }, { aliasName: "a".repeat(201) }, { headSha: "head" }, { member: "arbitrary" }]) {
      expect(evaluateTypeScriptUnionMember({ ...target, ...patch } as TypeScriptUnionMemberTarget, [artifact])).toMatchObject({ state: "unavailable", reason: "invalid_target", artifactDigest: null });
    }
    const atLimit = artifact.content + " ".repeat(64 * 1024 - Buffer.byteLength(artifact.content));
    expect(evaluateTypeScriptUnionMember(target, [blob(atLimit)]).state).toBe("supported");
    expect(evaluateTypeScriptUnionMember(target, [blob(atLimit + "é")])).toMatchObject({ state: "unavailable", reason: "artifact_unavailable" });
  });
});
