import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { ReportAuthenticity, VerificationReport } from "./types";
export const REPORT_SCHEMA_VERSION = "verification-report.v1" as const;
export const DETERMINISTIC_ENGINE_VERSION = "agentproof-deterministic.v1";
export const DEFAULT_REPORT_SIGNING_KEY_ID = "agentproof-report-hmac-v1";

type UnsignedSummaryReport = Omit<VerificationReport, "authenticity">;

export function createUnverifiedAuthenticity(
  trust: Extract<ReportAuthenticity["trust"], "imported_unverified" | "legacy_unverified" | "portable_unverified">
): ReportAuthenticity {
  return {
    version: 1,
    trust,
    generator: {
      reportSchemaVersion: REPORT_SCHEMA_VERSION,
      deterministicEngineVersion: DETERMINISTIC_ENGINE_VERSION
    }
  };
}

export function createVerifiedAuthenticity(report: VerificationReport, signingSecret: string): ReportAuthenticity {
  const payload = canonicalPayload(report);
  const canonicalDigest = sha256(payload);

  return {
    version: 1,
    trust: "verified_agentproof",
    generator: {
      reportSchemaVersion: REPORT_SCHEMA_VERSION,
      deterministicEngineVersion: DETERMINISTIC_ENGINE_VERSION
    },
    canonicalDigest,
    signingKeyId: process.env.AGENTPROOF_REPORT_SIGNING_KEY_ID?.trim() || DEFAULT_REPORT_SIGNING_KEY_ID,
    signature: createHmac("sha256", signingSecret).update(payload).digest("hex")
  };
}

export function verifyVerifiedAuthenticity(report: VerificationReport, signingSecret: string): boolean {
  const authenticity = report.authenticity;
  if (!authenticity || authenticity.trust !== "verified_agentproof") return false;
  if (!authenticity.canonicalDigest || !authenticity.signature) return false;

  const payload = canonicalPayload(report);
  const expectedDigest = sha256(payload);
  const expectedSignature = createHmac("sha256", signingSecret).update(payload).digest("hex");

  return safeEqual(authenticity.canonicalDigest, expectedDigest) && safeEqual(authenticity.signature, expectedSignature);
}

export function requireReportSigningSecret(): string {
  const secret = process.env.AGENTPROOF_REPORT_SIGNING_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error("AGENTPROOF_REPORT_SIGNING_SECRET must be configured with at least 32 characters before verified reports can be stored.");
  }
  return secret;
}

function canonicalPayload(report: VerificationReport): string {
  const { authenticity: _authenticity, ...unsigned } = report;
  return stableJson(unsigned);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
