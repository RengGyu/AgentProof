import { describe, expect, it } from "vitest";
import { buildLlmVerifierPackage } from "./llm-package";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

describe("buildLlmVerifierPackage", () => {
  it("packages normalized evidence with the structured schema", () => {
    const input = demoScenarios["scope-creep"];
    const report = generateVerificationReport(input);
    const pkg = buildLlmVerifierPackage(input, report);

    expect(pkg.schema.name).toBe("agentproof_verification_report");
    expect(pkg.input.evidenceIndex).toEqual(report.evidenceIndex);
    expect(pkg.input.deterministicReport.analysisId).toBe(report.analysisId);
    expect(JSON.stringify(pkg.schema.schema.properties.scope)).toContain('"evidenceRefs"');
    expect(JSON.stringify(pkg.schema.schema.properties.reviewPriority)).toContain('"evidenceRefs"');
    expect(JSON.stringify(pkg)).not.toContain("githubToken");
  });

  it("redacts secrets from direct input before packaging for the LLM", () => {
    const input = {
      ...demoScenarios.clean,
      taskText: "Use github_pat_abcdefghijklmnopqrstuvwxyz123456 and sk-testsecretabcdefghijklmnopqrstuvwxyz for this task."
    };
    const report = generateVerificationReport(input);
    const pkg = buildLlmVerifierPackage(input, report);
    const serialized = JSON.stringify(pkg);

    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("sk-testsecret");
    expect(serialized).toContain("[redacted]");
  });

  it("keeps every structured-output object property required for OpenAI strict mode", () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const pkg = buildLlmVerifierPackage(input, report);

    expectObjectPropertiesRequired(pkg.schema.schema, "schema");
  });
});

function expectObjectPropertiesRequired(schema: unknown, path: string) {
  if (!isRecord(schema)) {
    return;
  }

  if (schema.type === "object") {
    const properties = isRecord(schema.properties) ? Object.keys(schema.properties).sort() : [];
    const required = Array.isArray(schema.required) ? [...schema.required].sort() : [];

    expect(required, `${path}.required`).toEqual(properties);

    for (const key of properties) {
      expectObjectPropertiesRequired((schema.properties as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }

  if (schema.type === "array") {
    expectObjectPropertiesRequired(schema.items, `${path}[]`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}
