import { describe, expect, it, vi } from "vitest";
import { writeTextWithBrowserFallback } from "./browser-clipboard";

describe("browser clipboard fallback", () => {
  it("uses a temporary text area when the async clipboard API is blocked", async () => {
    const textarea = {
      value: "",
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      remove: vi.fn()
    };
    const document = {
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => true)
    };
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));

    await writeTextWithBrowserFallback("report text", {
      clipboard: { writeText },
      document: document as unknown as Document
    });

    expect(writeText).toHaveBeenCalledWith("report text");
    expect(textarea.value).toBe("report text");
    expect(document.body.appendChild).toHaveBeenCalledWith(textarea);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.remove).toHaveBeenCalledOnce();
  });
});
