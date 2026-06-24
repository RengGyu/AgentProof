import { afterEach, describe, expect, it, vi } from "vitest";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
import { POST } from "./route";

describe("POST /api/llm/verify", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is disabled without OpenAI key and internal verifier token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/llm/verify", {
        method: "POST",
        body: JSON.stringify({
          input: demoScenarios.clean,
          report: generateVerificationReport(demoScenarios.clean)
        })
      })
    );

    expect(response.status).toBe(501);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires the internal verifier token before model calls", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AGENTPROOF_LLM_TOKEN", "secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/llm/verify", {
        method: "POST",
        body: JSON.stringify({
          input: demoScenarios.clean,
          report: generateVerificationReport(demoScenarios.clean)
        })
      })
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
