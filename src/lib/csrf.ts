import { noStoreJson } from "./http";

export const CSRF_HEADER = "x-agentproof-csrf";
export const CSRF_HEADER_VALUE = "same-origin";

export type CsrfCheckResult =
  | { ok: true }
  | { ok: false; code: "origin_mismatch" | "csrf_header_missing" };

export function verifySameOriginMutationRequest(request: Request): CsrfCheckResult {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { ok: false, code: "origin_mismatch" };
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin
        ? { ok: true }
        : { ok: false, code: "origin_mismatch" };
    } catch {
      return { ok: false, code: "origin_mismatch" };
    }
  }

  return request.headers.get(CSRF_HEADER) === CSRF_HEADER_VALUE
    ? { ok: true }
    : { ok: false, code: "csrf_header_missing" };
}

export function csrfFailureResponse() {
  return noStoreJson({
    error: "Tenant mutations require a same-origin request.",
    code: "tenant_mutation_csrf_required"
  }, { status: 403 });
}
