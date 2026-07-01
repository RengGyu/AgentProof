import { describe, expect, it } from "vitest";
import { CSRF_HEADER, CSRF_HEADER_VALUE, verifySameOriginMutationRequest } from "./csrf";

describe("same-origin tenant mutation guard", () => {
  it("accepts matching origins", () => {
    const result = verifySameOriginMutationRequest(new Request("http://localhost/api/tenants/session", {
      method: "POST",
      headers: { Origin: "http://localhost" }
    }));

    expect(result).toEqual({ ok: true });
  });

  it("rejects mismatched origins", () => {
    const result = verifySameOriginMutationRequest(new Request("http://localhost/api/tenants/session", {
      method: "POST",
      headers: { Origin: "https://attacker.example" }
    }));

    expect(result).toEqual({ ok: false, code: "origin_mismatch" });
  });

  it("accepts the explicit same-origin marker when Origin is unavailable", () => {
    const result = verifySameOriginMutationRequest(new Request("http://localhost/api/tenants/session", {
      method: "POST",
      headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE }
    }));

    expect(result).toEqual({ ok: true });
  });

  it("rejects cross-site fetch metadata even with a marker header", () => {
    const result = verifySameOriginMutationRequest(new Request("http://localhost/api/tenants/session", {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "cross-site",
        [CSRF_HEADER]: CSRF_HEADER_VALUE
      }
    }));

    expect(result).toEqual({ ok: false, code: "origin_mismatch" });
  });
});
