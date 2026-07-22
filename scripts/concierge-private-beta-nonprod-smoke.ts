import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { validateVerificationReport } from "../src/lib/report-validation";
// @ts-expect-error The executable contract is deliberately plain ESM for Node smoke use.
import { inspectSmokeResponse, validateApprovedSmokeOrigin, validateSmokeCases, validateSmokeHttpBoundary, validateSmokeTelemetrySet } from "./concierge-private-beta-nonprod-smoke-contract.mjs";

export const MAX_RESPONSE_BYTES = 2_000_000;
const endpointPath = "/api/tenants/concierge/analyze";

export interface ConciergeSmokeRunResult {
  exitCode: 0 | 1 | 2;
  summary: Record<string, unknown>;
}

export interface ConciergeSmokeRunOptions {
  baseUrl: string;
  /** Exact approved HTTPS origin for a request carrying a protection bypass. */
  approvedOrigin?: string;
  sessionCookie: string;
  cases: unknown;
  /** Request-only Vercel Preview deployment-protection credential. */
  vercelProtectionBypass?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Runs the bounded non-production smoke protocol. It intentionally returns a
 * bounded result instead of logging request secrets or full reports, making
 * the executable testable without an external GitHub or Supabase environment.
 */
export async function runConciergeNonProductionSmoke(options: ConciergeSmokeRunOptions): Promise<ConciergeSmokeRunResult> {
  if (!validateSmokeCases(options.cases)) return smokeResult(2, []);
  const bypass = options.vercelProtectionBypass?.trim();
  // This helper is exported for tests. Do not rely only on CLI validation
  // before sending either a durable session or a deployment credential.
  if (!validateApprovedSmokeOrigin(options.baseUrl, options.approvedOrigin ?? "")) return smokeResult(2, []);
  const endpoint = `${options.baseUrl}${endpointPath}`;
  const observed: Array<Record<string, unknown>> = [];
  const telemetryBindings: Array<{ caseIdOrHash: string }> = [];
  let telemetryGateFailed = false;
  const fetchImpl = options.fetchImpl ?? fetch;

  for (const item of options.cases as Array<Record<string, unknown>>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        headers: smokeHeaders(options, bypass),
        // Manifest IDs are preflight metadata only. The Concierge route derives
        // authority from the durable session and rejects browser-supplied IDs.
        body: JSON.stringify({ repositoryFullName: item.repositoryFullName, pullRequestNumber: item.pullRequestNumber, requestId: randomUUID() }),
        signal: controller.signal
      });
      const body = await readBoundedJson(response);
      const httpBoundaryValid = validateSmokeHttpBoundary(response, endpoint);
      if (response.status !== 200) {
        observed.push({ caseId: item.caseId, status: !body?.report && httpBoundaryValid ? "failed_expected" : "failed", httpStatus: response.status, reportPresent: Boolean(body?.report), httpBoundaryValid });
        continue;
      }
      const report = body?.report;
      const runtimeReportValid = validateVerificationReport(report, { mode: "full", requireSourceProvenance: true }).valid;
      const inspected = inspectSmokeResponse(item, response.status, body, runtimeReportValid);
      if (!inspected.telemetryValid || !inspected.telemetryCaseIdOrHash) telemetryGateFailed = true;
      else telemetryBindings.push({ caseIdOrHash: inspected.telemetryCaseIdOrHash });
      const { telemetryCaseIdOrHash: _telemetryCaseIdOrHash, ...bounded } = inspected;
      observed.push({ caseId: item.caseId, ...bounded, status: inspected.status === "passed" && httpBoundaryValid ? "passed" : "failed", httpBoundaryValid });
    } catch {
      observed.push({ caseId: item.caseId, status: "failed", httpStatus: null, originalTaskStatus: null, ciStatus: null, metCount: -1, httpBoundaryValid: false });
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!validateSmokeTelemetrySet(telemetryBindings)) telemetryGateFailed = true;
  return smokeResult(telemetryGateFailed ? 2 : observed.some((item) => item.status !== "passed") ? 1 : 0, observed);
}

function smokeResult(exitCode: 0 | 1 | 2, observed: Array<Record<string, unknown>>): ConciergeSmokeRunResult {
  return {
    exitCode,
    summary: {
      smokeVersion: "concierge-private-beta-nonprod-smoke.v4",
      caseCount: observed.length,
      passedCount: observed.filter((item) => item.status === "passed").length,
      sideEffectTelemetry: "runtime_instrumented_zero_counter_required",
      negativeSmokeRequired: true,
      cases: observed
    }
  };
}

async function runFromEnvironment(): Promise<ConciergeSmokeRunResult> {
  if (process.env.AGENTPROOF_CONCIERGE_SMOKE_EXECUTE !== "1") stop("EXPLICIT_EXECUTION_REQUIRED: set AGENTPROOF_CONCIERGE_SMOKE_EXECUTE=1 after non-production approval.");
  const baseUrl = validateApprovedSmokeOrigin(process.env.AGENTPROOF_CONCIERGE_SMOKE_BASE_URL, process.env.AGENTPROOF_CONCIERGE_SMOKE_APPROVED_ORIGIN);
  const sessionCookie = process.env.AGENTPROOF_CONCIERGE_SMOKE_SESSION_COOKIE;
  const casesPath = process.env.AGENTPROOF_CONCIERGE_SMOKE_CASES_PATH;
  if (!baseUrl || !sessionCookie || !casesPath) stop("SMOKE_CONFIGURATION_REQUIRED: approved HTTPS origin, base URL, session cookie, and case manifest path are required.");
  let cases: unknown;
  try { cases = JSON.parse(await readFile(casesPath, "utf8")); } catch { stop("SMOKE_CASE_MANIFEST_INVALID"); }
  return runConciergeNonProductionSmoke({
    baseUrl,
    approvedOrigin: baseUrl,
    sessionCookie,
    cases,
    vercelProtectionBypass: process.env.AGENTPROOF_CONCIERGE_SMOKE_VERCEL_PROTECTION_BYPASS
  });
}

function smokeHeaders(options: ConciergeSmokeRunOptions, bypass?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: options.baseUrl,
    Cookie: options.sessionCookie,
    "x-agentproof-csrf": "same-origin"
  };
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  return headers;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const result = await runFromEnvironment();
  console.log(JSON.stringify(result.summary));
  process.exit(result.exitCode);
}

function stop(message: string): never {
  console.error(message);
  process.exit(2);
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown> | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
