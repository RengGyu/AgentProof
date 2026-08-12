import { describe, expect, it, vi } from "vitest";
import { writeDeferredTextWithBrowserFallback, writeTextWithBrowserFallback } from "./browser-clipboard";

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

  it("claims the clipboard gesture before a revalidated report finishes loading", async () => {
    let resolveText: ((value: string) => void) | undefined;
    const events: string[] = [];
    const loadText = vi.fn(() => {
      events.push("load");
      return new Promise<string>((resolve) => { resolveText = resolve; });
    });
    const write = vi.fn(async (items: ClipboardItems) => {
      events.push("write");
      const [item] = items as unknown as Array<{ text: Promise<string> }>;
      await item.text;
    });

    const copying = writeDeferredTextWithBrowserFallback({
      fallbackText: "already displayed report",
      loadText,
      dependencies: {
        clipboard: { write },
        createClipboardItem: (text) => ({ text }) as unknown as ClipboardItem
      }
    });

    expect(events).toEqual(["load", "write"]);
    resolveText?.("freshly revalidated report");
    await copying;
    expect(write).toHaveBeenCalledOnce();
  });

  it("copies the already displayed report immediately when deferred clipboard items are unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const loadText = vi.fn(async () => "must not load before direct copy");

    await writeDeferredTextWithBrowserFallback({
      fallbackText: "already displayed report",
      loadText,
      dependencies: { clipboard: { writeText } }
    });

    expect(writeText).toHaveBeenCalledWith("already displayed report");
    expect(loadText).not.toHaveBeenCalled();
  });

  it("uses the synchronous document fallback instead of awaiting a blocked clipboard API", async () => {
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

    await writeDeferredTextWithBrowserFallback({
      fallbackText: "already displayed report",
      loadText: async () => "must not load before direct copy",
      dependencies: { clipboard: { writeText }, document: document as unknown as Document }
    });

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(writeText).not.toHaveBeenCalled();
  });
});
