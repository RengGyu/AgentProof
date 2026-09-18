import { closeSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { GeneralPrSemanticProviderFailure } from "../src/lib/general-pr-semantic-observer";
import { submitGeneralPrSemanticObservationWithOpenAI } from "../src/lib/openai-semantic";
import {
  RequirementRoleExperimentProviderError,
  type RequirementRoleExperimentProvider,
  type RequirementRoleExperimentTelemetry,
} from "./requirement-role-experiment";

interface LiveProviderOptions {
  apiKey: string;
  fetchFn?: typeof fetch;
  clock?: () => number;
  journalPath?: string;
}

const identifier = /^[A-Za-z0-9_.:-]{1,100}$/;
const emptyTelemetry = (): RequirementRoleExperimentTelemetry => ({ latencyMs: null, httpStatus: null, observedModel: null, inputTokens: null, outputTokens: null, totalTokens: null });
const token = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function loadOpenAIKeyFromEnvFile(path: string): string {
  const content = readFileSync(path, "utf8");
  const assignments = content.match(/^(?:[ \t]*export[ \t]+)?[ \t]*OPENAI_API_KEY[ \t]*=.*$/gm) ?? [];
  if (assignments.length !== 1) throw new Error("selected env file must contain exactly one OPENAI_API_KEY assignment");
  const localRequire = createRequire(import.meta.url);
  const nextPackage = localRequire.resolve("next/package.json");
  const dependencyRequire = createRequire(join(dirname(dirname(nextPackage)), "__agentproof_env_loader.cjs"));
  const { processEnv } = dependencyRequire("@next/env") as {
    processEnv(files: Array<{ path: string; contents: string; env: Record<string, string | undefined> }>, dir?: string, log?: { info(...args: unknown[]): void; error(...args: unknown[]): void }, forceReload?: boolean): Array<Record<string, string | undefined>>;
  };
  const priorKey = process.env.OPENAI_API_KEY;
  const priorProcessed = process.env.__NEXT_PROCESSED_ENV;
  try {
    delete process.env.OPENAI_API_KEY;
    delete process.env.__NEXT_PROCESSED_ENV;
    const parsed = processEnv([{ path: basename(path), contents: `${assignments[0]}\n`, env: {} }], dirname(path), { info() {}, error() {} }, true)[1];
    const key = parsed?.OPENAI_API_KEY?.trim();
    if (!key) throw new Error("selected env file contains an empty OPENAI_API_KEY");
    return key;
  } finally {
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    if (priorProcessed === undefined) delete process.env.__NEXT_PROCESSED_ENV; else process.env.__NEXT_PROCESSED_ENV = priorProcessed;
  }
}

export function createOpenAIRequirementRoleExperimentProvider(options: LiveProviderOptions): RequirementRoleExperimentProvider {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("nonempty API key required");
  const clock = options.clock ?? Date.now;
  if (options.journalPath) {
    try { closeSync(openSync(options.journalPath, "wx", 0o600)); }
    catch (error) { throw new Error("call journal already exists or cannot be created", { cause: error }); }
  }
  const journal = (event: Record<string, unknown>) => {
    if (!options.journalPath) return;
    const fd = openSync(options.journalPath, "a", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify({ schemaVersion: "requirement_role_call_journal.v1", ...event })}\n`);
      fsyncSync(fd);
    } finally { closeSync(fd); }
  };
  return { observe: async request => {
    const telemetry = emptyTelemetry();
    const started = clock();
    journal({ event: "started", state: "in_flight", at: new Date(started).toISOString(), callId: request.callId, caseId: request.caseId, version: request.version, pass: request.pass, requestHash: request.requestHash });
    const transport: typeof fetch = async (url, init) => {
      const signal = request.signal && init?.signal ? AbortSignal.any([request.signal, init.signal]) : request.signal ?? init?.signal;
      const response = await (options.fetchFn ?? fetch)(url, { ...init, signal });
      telemetry.httpStatus = response.status;
      try {
        const payload: unknown = await response.clone().json();
        if (record(payload)) {
          telemetry.observedModel = typeof payload.model === "string" && identifier.test(payload.model) ? payload.model : null;
          if (record(payload.usage)) {
            telemetry.inputTokens = token(payload.usage.input_tokens);
            telemetry.outputTokens = token(payload.usage.output_tokens);
            telemetry.totalTokens = token(payload.usage.total_tokens);
          }
        }
      } catch { /* Metadata unavailable; never retain response bodies or parsing errors. */ }
      return response;
    };
    try {
      const output = await submitGeneralPrSemanticObservationWithOpenAI(request.packet, { apiKey, fetchFn: transport });
      telemetry.latencyMs = Math.max(0, clock() - started);
      journal({ event: "finished", state: "provider_succeeded", at: new Date(started + telemetry.latencyMs).toISOString(), callId: request.callId, caseId: request.caseId, version: request.version, pass: request.pass, requestHash: request.requestHash, ...telemetry });
      return { output, telemetry };
    } catch (error) {
      telemetry.latencyMs = Math.max(0, clock() - started);
      const category = error instanceof GeneralPrSemanticProviderFailure ? error.diagnostic?.category : undefined;
      journal({ event: "finished", state: "provider_failed", at: new Date(started + telemetry.latencyMs).toISOString(), callId: request.callId, caseId: request.caseId, version: request.version, pass: request.pass, requestHash: request.requestHash, errorCategory: category ?? "unknown", ...telemetry });
      throw new RequirementRoleExperimentProviderError(category ? `provider_${category}` : "provider_error", telemetry);
    }
  } };
}
