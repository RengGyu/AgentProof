export const verificationReportSchema = {
  name: "agentproof_verification_report",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "analysisId",
      "createdAt",
      "source",
      "summary",
      "requirements",
      "claims",
      "scope",
      "testing",
      "reviewPriority",
      "reprompt",
      "evidenceIndex",
      "limitations"
    ],
    properties: {
      analysisId: { type: "string", maxLength: 160 },
      createdAt: { type: "string", maxLength: 80 },
      source: {
        type: "object",
        additionalProperties: false,
        required: ["title"],
        properties: {
          title: { type: "string", maxLength: 600 },
          url: { type: "string", maxLength: 500 },
          author: { type: "string", maxLength: 120 },
          baseBranch: { type: "string", maxLength: 120 },
          headBranch: { type: "string", maxLength: 120 }
        }
      },
      summary: {
        type: "object",
        additionalProperties: false,
        required: ["oneLine", "confidence", "priority", "evidenceCoverage", "topRisks"],
        properties: {
          oneLine: { type: "string", maxLength: 1000 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          priority: { type: "string", enum: ["low", "medium", "high", "blocker"] },
          evidenceCoverage: { type: "number", minimum: 0, maximum: 100 },
          topRisks: { type: "array", maxItems: 20, items: { type: "string", maxLength: 600 } }
        }
      },
      requirements: {
        type: "array",
        maxItems: 40,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["requirementId", "requirementText", "status", "evidenceRefs", "gaps", "reviewerNote", "confidence"],
          properties: {
            requirementId: { type: "string", maxLength: 600 },
            requirementText: { type: "string", maxLength: 2000 },
            status: { type: "string", enum: ["met", "partial", "missing", "unclear"] },
            evidenceRefs: { type: "array", maxItems: 50, items: { type: "string", maxLength: 600 } },
            gaps: { type: "array", maxItems: 20, items: { type: "string", maxLength: 600 } },
            reviewerNote: { type: "string", maxLength: 600 },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      },
      claims: {
        type: "array",
        maxItems: 40,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "text", "evidenceRefs", "supported"],
          properties: {
            id: { type: "string", maxLength: 600 },
            text: { type: "string", maxLength: 2000 },
            evidenceRefs: { type: "array", maxItems: 50, items: { type: "string", maxLength: 600 } },
            supported: { type: "boolean" }
          }
        }
      },
      scope: {
        type: "object",
        additionalProperties: false,
        required: ["suspected", "outOfScopeFiles", "reasons"],
        properties: {
          suspected: { type: "boolean" },
          outOfScopeFiles: { type: "array", maxItems: 100, items: { type: "string", maxLength: 500 } },
          reasons: { type: "array", maxItems: 100, items: { type: "string", maxLength: 600 } }
        }
      },
      testing: {
        type: "object",
        additionalProperties: false,
        required: ["ciStatus", "lintStatus", "typecheckStatus", "missingTests"],
        properties: {
          ciStatus: { type: "string", enum: ["passed", "failed", "pending", "unknown"] },
          lintStatus: { type: "string", enum: ["passed", "failed", "pending", "unknown"] },
          typecheckStatus: { type: "string", enum: ["passed", "failed", "pending", "unknown"] },
          missingTests: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path", "why", "evidenceRefs"],
              properties: {
                path: { type: "string", maxLength: 500 },
                why: { type: "string", maxLength: 600 },
                evidenceRefs: { type: "array", maxItems: 50, items: { type: "string", maxLength: 600 } }
              }
            }
          }
        }
      },
      reviewPriority: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "reason", "priority"],
          properties: {
            path: { type: "string", maxLength: 500 },
            reason: { type: "string", maxLength: 600 },
            priority: { type: "string", enum: ["low", "medium", "high", "blocker"] }
          }
        }
      },
      reprompt: {
        type: "object",
        additionalProperties: false,
        required: ["targetAgent", "prompt"],
        properties: {
          targetAgent: { type: "string", enum: ["codex", "claude_code", "cursor", "copilot"] },
          prompt: { type: "string", maxLength: 6000 }
        }
      },
      evidenceIndex: {
        type: "array",
        maxItems: 200,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "kind", "label", "summary", "confidence"],
          properties: {
            id: { type: "string", maxLength: 600 },
            kind: { type: "string", enum: ["task", "pr_description", "diff", "changed_file", "check", "log", "test", "inference"] },
            label: { type: "string", maxLength: 600 },
            summary: { type: "string", maxLength: 3000 },
            locator: { type: "string", maxLength: 1000 },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      },
      limitations: { type: "array", maxItems: 50, items: { type: "string", maxLength: 600 } }
    }
  },
  strict: true
} as const;

export const llmBoundaryPrompt = `
You are AgentProof's verifier. Do not write a generic code review.
Use only the normalized evidence provided by the application.
Every finding must cite evidence IDs. If evidence is weak, use unclear.
Return only JSON that matches the AgentProof verification schema.
`;
