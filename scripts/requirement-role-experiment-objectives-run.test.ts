import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { runRequirementRoleObjectiveExperiment } from "./requirement-role-experiment-objectives";

const inputPath = process.env.REQUIREMENT_ROLE_OBJECTIVE_INPUT;

it.skipIf(!inputPath)("writes one sanitized offline objective comparison", async () => {
  const corpus: unknown = JSON.parse(readFileSync(inputPath!, "utf8"));
  const reviewPath = process.env.REQUIREMENT_ROLE_OBJECTIVE_REVIEW;
  const review: unknown = reviewPath ? JSON.parse(readFileSync(reviewPath, "utf8")) : undefined;
  const result = await runRequirementRoleObjectiveExperiment(corpus, {
    modelProfile: {
      model: process.env.REQUIREMENT_ROLE_OBJECTIVE_MODEL!,
      promptVersion: "requirement-role-objective-separation.v1",
      inputFieldPolicyVersion: "existing-v0-source-units.v1",
    },
    review,
  });
  const fd = openSync(process.env.REQUIREMENT_ROLE_OBJECTIVE_OUTPUT!, "wx", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(result, null, 2)}\n`); }
  finally { closeSync(fd); }
  expect(result).toMatchObject({ offline: true, actualCallCount: 0 });
});
