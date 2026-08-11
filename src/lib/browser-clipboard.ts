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

  const document = dependencies.document ?? (typeof window === "undefined" ? undefined : window.document);
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
