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
      analysisId: { type: "string" },
      createdAt: { type: "string" },
      source: {
        type: "object",
        additionalProperties: false,
        required: ["title"],
        properties: {
          title: { type: "string", maxLength: 300 },
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
          oneLine: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          priority: { type: "string", enum: ["low", "medium", "high", "blocker"] },
          evidenceCoverage: { type: "number", minimum: 0, maximum: 100 },
          topRisks: { type: "array", items: { type: "string" } }
        }
      },
      requirements: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["requirementId", "requirementText", "status", "evidenceRefs", "gaps", "reviewerNote", "confidence"],
          properties: {
            requirementId: { type: "string" },
            requirementText: { type: "string" },
            status: { type: "string", enum: ["met", "partial", "missing", "unclear"] },
            evidenceRefs: { type: "array", items: { type: "string" } },
            gaps: { type: "array", items: { type: "string" } },
            reviewerNote: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      },
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "text", "evidenceRefs", "supported"],
          properties: {
            id: { type: "string" },
            text: { type: "string" },
            evidenceRefs: { type: "array", items: { type: "string" } },
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
          outOfScopeFiles: { type: "array", items: { type: "string" } },
          reasons: { type: "array", items: { type: "string" } }
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
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path", "why", "evidenceRefs"],
              properties: {
                path: { type: "string", maxLength: 500 },
                why: { type: "string", maxLength: 600 },
                evidenceRefs: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      },
      reviewPriority: {
        type: "array",
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
          prompt: { type: "string" }
        }
      },
      evidenceIndex: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "kind", "label", "summary", "confidence"],
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["task", "pr_description", "diff", "changed_file", "check", "log", "test", "inference"] },
            label: { type: "string" },
            summary: { type: "string" },
            locator: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      },
      limitations: { type: "array", items: { type: "string" } }
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
