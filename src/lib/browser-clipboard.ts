export async function writeTextWithBrowserFallback(
  text: string,
  dependencies: {
    clipboard?: Pick<Clipboard, "writeText">;
    document?: Document;
  } = {}
): Promise<void> {
  const clipboard = dependencies.clipboard ?? (typeof navigator === "undefined" ? undefined : navigator.clipboard);
  try {
    if (!clipboard) throw new Error("clipboard_unavailable");
    await clipboard.writeText(text);
    return;
  } catch {
    // Some mobile in-app browsers block navigator.clipboard but still permit
    // the user-initiated document copy fallback below.
  }

  copyTextWithDocumentFallback(text, dependencies.document ?? (typeof window === "undefined" ? undefined : window.document));
}

/**
 * Starts a clipboard write during the user gesture, while allowing the text
 * itself to finish loading afterwards. This is required by Safari and some
 * in-app browsers, which reject a clipboard write started after an awaited
 * network revalidation.
 */
export async function writeDeferredTextWithBrowserFallback(input: {
  fallbackText: string;
  loadText: () => Promise<string>;
  dependencies?: {
    clipboard?: Partial<Pick<Clipboard, "write" | "writeText">>;
    createClipboardItem?: (text: Promise<string>) => ClipboardItem;
    document?: Document;
  };
}): Promise<void> {
  const dependencies = input.dependencies ?? {};
  const clipboard = dependencies.clipboard ?? (typeof navigator === "undefined" ? undefined : navigator.clipboard);
  const createClipboardItem = dependencies.createClipboardItem ?? nativeClipboardItemFactory();

  if (clipboard?.write && createClipboardItem) {
    const text = input.loadText();
    await clipboard.write([createClipboardItem(text)]);
    return;
  }

  const document = dependencies.document ?? (typeof window === "undefined" ? undefined : window.document);
  if (document?.body && typeof document.execCommand === "function") {
    copyTextWithDocumentFallback(input.fallbackText, document);
    return;
  }

  await writeTextWithBrowserFallback(input.fallbackText, {
    ...(clipboard?.writeText ? { clipboard: { writeText: clipboard.writeText } } : {}),
    document: dependencies.document
  });
}

function copyTextWithDocumentFallback(text: string, document: Document | undefined): void {
  if (!document?.body || typeof document.execCommand !== "function") {
    throw new Error("clipboard_unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    if (!document.execCommand("copy")) throw new Error("clipboard_fallback_failed");
  } finally {
    textarea.remove();
  }
}

function nativeClipboardItemFactory(): ((text: Promise<string>) => ClipboardItem) | undefined {
  if (typeof ClipboardItem !== "function") return undefined;
  return (text) => new ClipboardItem({
    "text/plain": text.then((value) => new Blob([value], { type: "text/plain" }))
  });
}
