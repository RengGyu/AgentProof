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
      source: { type: "object" },
      summary: { type: "object" },
      requirements: { type: "array" },
      claims: { type: "array" },
      scope: { type: "object" },
      testing: { type: "object" },
      reviewPriority: { type: "array" },
      reprompt: { type: "object" },
      evidenceIndex: { type: "array" },
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
