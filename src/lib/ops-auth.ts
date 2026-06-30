import { timingSafeEqual } from "crypto";
import { noStoreJson } from "./http";

export const OPS_TOKEN_HEADER = "x-agentproof-ops-token";

export type OpsAuthResult =
  | { ok: true }
  | { ok: false; response: Response };

export function verifyOpsRequest(request: Request, env = process.env): OpsAuthResult {
  const opsToken = env.AGENTPROOF_OPS_TOKEN?.trim();

  if (!opsToken) {
    return {
      ok: false,
      response: noStoreJson({
        error: "Operator diagnostics are not configured.",
        code: "ops_diagnostics_not_configured"
      }, { status: 501 })
    };
  }

  if (!constantTimeEquals(request.headers.get(OPS_TOKEN_HEADER), opsToken)) {
    return {
      ok: false,
      response: noStoreJson({
        error: "Invalid operator diagnostics token.",
        code: "ops_diagnostics_unauthorized"
      }, { status: 401 })
    };
  }

  return { ok: true };
}

function constantTimeEquals(left: string | null, right: string): boolean {
  if (!left) return false;

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
