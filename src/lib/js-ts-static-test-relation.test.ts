import { describe, expect, it } from "vitest";
import { resolveJsTsStaticTestRelationV1 } from "./js-ts-static-test-relation";

const input = (overrides: Partial<Parameters<typeof resolveJsTsStaticTestRelationV1>[0]> = {}) => ({
  testPath: "test/status.test.ts",
  testSource: [
    "import { statusLabel as label } from '../src/status';",
    "test('labels ready', () => { expect(label(true)).toBe('Ready'); });"
  ].join("\n"),
  modules: [{ path: "src/status.ts", source: "export function statusLabel(ready: boolean) { return ready ? 'Ready' : 'Blocked'; }" }],
  ...overrides
});

describe("resolveJsTsStaticTestRelationV1", () => {
  it("uses the TypeScript AST to bind a unique static named alias and direct assertion", () => {
    const relation = resolveJsTsStaticTestRelationV1(input());

    expect(relation).toMatchObject({ state: "verified", importRelation: { level: "verified", basis: "typescript_ast_relation" }, assertionRelation: { level: "verified", basis: "typescript_ast_relation" } });
  });

  it("supports explicit re-exports and default imports through the supplied immutable module set", () => {
    const relation = resolveJsTsStaticTestRelationV1(input({
      testSource: "import label from '../src/barrel'; expect(label(true)).toBe('Ready');",
      modules: [{ path: "src/barrel.ts", source: "const label = (value: boolean) => value ? 'Ready' : 'Blocked'; export default label;" }]
    }));

    expect(relation).toMatchObject({ state: "verified" });
  });

  it.each([
    "const label = await import('../src/status'); expect(label(true)).toBe('Ready');",
    "const label = require('../src/status'); expect(label(true)).toBe('Ready');",
    "import { statusLabel as label } from '../src/status'; expect('label(true)').toBe('Ready');",
    "import { statusLabel as label } from '../src/status'; expect(/* label(true) */ true).toBe(true);",
    "import { statusLabel as label } from '../src/status'; expect(label(...args)).toBe('Ready');",
    "import { statusLabel as label } from '../src/status'; expect(wrapper(label(true))).toBe('Ready');",
    "import { statusLabel as label } from '../src/status'; expect(true).toBe(true); label(true);"
  ])("returns unresolved for dynamic or non-direct syntax: %s", (testSource) => {
    expect(resolveJsTsStaticTestRelationV1(input({ testSource }))).toMatchObject({ state: "unresolved" });
  });

  it("does not turn the static relation into test applicability, execution, or requirement proof", () => {
    const relation = resolveJsTsStaticTestRelationV1(input());

    expect(JSON.stringify(relation)).not.toContain("requirement");
    expect(JSON.stringify(relation)).not.toContain("execution");
    expect(JSON.stringify(relation)).not.toContain("applicability");
  });
});
