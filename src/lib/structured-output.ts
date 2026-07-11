const findingProvenanceSchema = {
  type: "array",
  maxItems: 20,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["evidenceRef", "sourceType", "locator", "confidence", "evidenceText"],
    properties: {
      evidenceRef: { type: "string", maxLength: 600 },
      sourceType: { type: "string", enum: ["task", "pr_description", "diff", "changed_file", "check", "log", "test", "inference"] },
      locator: { type: ["string", "null"], maxLength: 1000 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidenceText: { type: "string", maxLength: 600 }
    }
  }
} as const;

const evidenceRefArraySchema = {
  type: "array",
  maxItems: 50,
  items: { type: "string", maxLength: 600 }
} as const;

const requirementContextRoleEnum = [
  "problem_context",
  "reproduction_context",
  "environment_context",
  "visual_context",
  "external_reference",
  "solution_hint",
  "author_claim"
] as const;

const requirementSourceQualityEnum = [
  "linked_issue",
  "explicit_acceptance_criteria",
  "expected_behavior",
  "requirement_language",
  "problem_statement",
  "solution_hint",
  "author_claim",
  "manual_check",
  "fallback"
] as const;

const proofGapSignalSchema = {
  type: "array",
  maxItems: 20,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "severity", "message", "evidenceRefs"],
    properties: {
      kind: {
        type: "string",
        enum: [
          "missing_implementation",
          "missing_targeted_test",
          "missing_execution",
          "failed_execution",
          "ambiguous_requirement",
          "self_reported_test_gap",
          "evidence_unavailable",
          "visual_proof_missing"
        ]
      },
      severity: { type: "string", enum: ["low", "medium", "high", "blocker"] },
      message: { type: "string", maxLength: 600 },
      evidenceRefs: evidenceRefArraySchema
    }
  }
} as const;

const proofGraphSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "nodes", "context", "summary"],
  properties: {
    version: { type: "number", enum: [1] },
    nodes: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "requirementId",
          "requirementText",
          "sourceRole",
          "sourceQuality",
          "sourceSection",
          "contextRoles",
          "status",
          "confidence",
          "implementationEvidenceRefs",
          "targetedTestEvidenceRefs",
          "executionEvidenceRefs",
          "gapSignals",
          "firstFiles"
        ],
        properties: {
          requirementId: { type: "string", maxLength: 600 },
          requirementText: { type: "string", maxLength: 2000 },
          sourceRole: { type: "string", enum: ["core_requirement"] },
          sourceQuality: { type: "string", enum: requirementSourceQualityEnum },
          sourceSection: { type: ["string", "null"], maxLength: 600 },
          contextRoles: { type: "array", maxItems: 30, items: { type: "string", enum: requirementContextRoleEnum } },
          status: { type: "string", enum: ["met", "partial", "missing", "unclear"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          implementationEvidenceRefs: evidenceRefArraySchema,
          targetedTestEvidenceRefs: evidenceRefArraySchema,
          executionEvidenceRefs: evidenceRefArraySchema,
          gapSignals: proofGapSignalSchema,
          firstFiles: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } }
        }
      }
    },
    context: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "source", "role", "sourceQuality", "sourceSection", "text"],
        properties: {
          id: { type: "string", maxLength: 600 },
          source: { type: "string", enum: ["task", "issue", "pr_description", "manual"] },
          role: { type: "string", enum: requirementContextRoleEnum },
          sourceQuality: { type: "string", enum: requirementSourceQualityEnum },
          sourceSection: { type: ["string", "null"], maxLength: 600 },
          text: { type: "string", maxLength: 600 }
        }
      }
    },
    summary: {
      type: "object",
      additionalProperties: false,
      required: [
        "requirementCount",
        "requirementsWithImplementation",
        "requirementsWithTargetedTests",
        "requirementsWithExecution",
        "requirementsWithGaps",
        "gapCount"
      ],
      properties: {
        requirementCount: { type: "number", minimum: 0, maximum: 800 },
        requirementsWithImplementation: { type: "number", minimum: 0, maximum: 800 },
        requirementsWithTargetedTests: { type: "number", minimum: 0, maximum: 800 },
        requirementsWithExecution: { type: "number", minimum: 0, maximum: 800 },
        requirementsWithGaps: { type: "number", minimum: 0, maximum: 800 },
        gapCount: { type: "number", minimum: 0, maximum: 800 }
      }
    }
  }
} as const;

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
      "proofGraph",
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
        required: ["title", "url", "author", "baseBranch", "headBranch"],
        properties: {
          title: { type: "string", maxLength: 600 },
          url: { type: ["string", "null"], maxLength: 500 },
          author: { type: ["string", "null"], maxLength: 120 },
          baseBranch: { type: ["string", "null"], maxLength: 120 },
          headBranch: { type: ["string", "null"], maxLength: 120 }
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
        required: ["suspected", "outOfScopeFiles", "reasons", "evidenceRefs", "provenance"],
        properties: {
          suspected: { type: "boolean" },
          outOfScopeFiles: { type: "array", maxItems: 100, items: { type: "string", maxLength: 500 } },
          reasons: { type: "array", maxItems: 100, items: { type: "string", maxLength: 600 } },
          evidenceRefs: { type: "array", maxItems: 50, items: { type: "string", maxLength: 600 } },
          provenance: findingProvenanceSchema
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
              required: ["path", "why", "evidenceRefs", "provenance"],
              properties: {
                path: { type: "string", maxLength: 500 },
                why: { type: "string", maxLength: 600 },
                evidenceRefs: { type: "array", maxItems: 50, items: { type: "string", maxLength: 600 } },
                provenance: findingProvenanceSchema
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
          required: ["path", "reason", "priority", "evidenceRefs"],
          properties: {
            path: { type: "string", maxLength: 500 },
            reason: { type: "string", maxLength: 600 },
            priority: { type: "string", enum: ["low", "medium", "high", "blocker"] },
            evidenceRefs: { type: "array", maxItems: 50, items: { type: "string", maxLength: 600 } }
          }
        }
      },
      proofGraph: proofGraphSchema,
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
          required: ["id", "kind", "label", "summary", "locator", "confidence"],
          properties: {
            id: { type: "string", maxLength: 600 },
            kind: { type: "string", enum: ["task", "pr_description", "diff", "changed_file", "check", "log", "test", "inference"] },
            label: { type: "string", maxLength: 600 },
            summary: { type: "string", maxLength: 3000 },
            locator: { type: ["string", "null"], maxLength: 1000 },
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
Preserve deterministic testing status and proofGraph evidence classes; do not turn self-reported testing into execution proof.
Return only JSON that matches the AgentProof verification schema.
`;
