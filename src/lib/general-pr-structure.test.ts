import { describe, expect, it } from "vitest";
import { extractRequirementEvidence } from "./extractors";
import { parseGeneralPrStructureV1 } from "./general-pr-structure";

describe("parseGeneralPrStructureV1", () => {
  it("binds GFM structural spans to exact UTF-16 source slices without retaining raw text", () => {
    const source = [
      "# Goal 🧪\r\n",
      "## PRIVATE_HEADING_MUST_NOT_BE_RETAINED\r\n",
      "\r\n",
      "- Parent item\r\n",
      "  - Child item\r\n",
      "\r\n",
      "> Quoted context\r\n",
      "\r\n",
      "| Name | Value |\r\n",
      "| --- | --- |\r\n",
      "| One | Two |\r\n",
      "\r\n",
      "```ts\r\n",
      "const privateCode = 'PRIVATE_RAW_CODE_MUST_NOT_BE_RETAINED';\r\n",
      "```\r\n",
      "\r\n",
      "<!-- PRIVATE_RAW_COMMENT_MUST_NOT_BE_RETAINED -->\r\n",
      "\r\n",
      "Actual paragraph.\r\n"
    ].join("");

    const result = parseGeneralPrStructureV1(source);

    expect(result.version).toBe(1);
    expect(result.parseState).toBe("complete");
    expect(result.spans.map((span) => span.kind)).toEqual(expect.arrayContaining([
      "heading", "list_item", "blockquote", "table_cell", "code", "html", "paragraph"
    ]));
    expect(result.spans.map((span) => span.id)).toEqual(result.spans.map((_, index) => `gsp_${index + 1}`));
    expect(result.spans.every((span) => source.slice(span.start, span.end).length > 0)).toBe(true);
    expect(result.spans.every((span) => span.start < span.end)).toBe(true);

    const heading = result.spans.find((span) => span.kind === "heading");
    const listItem = result.spans.find((span) => span.kind === "list_item");
    const tableCell = result.spans.find((span) => span.kind === "table_cell");
    const code = result.spans.find((span) => span.kind === "code");
    const html = result.spans.find((span) => span.kind === "html");

    expect(heading && source.slice(heading.start, heading.end)).toBe("# Goal 🧪");
    expect(listItem && source.slice(listItem.start, listItem.end)).toContain("Parent item");
    expect(tableCell && source.slice(tableCell.start, tableCell.end)).toContain("Name");
    expect(code && source.slice(code.start, code.end)).toContain("PRIVATE_RAW_CODE_MUST_NOT_BE_RETAINED");
    expect(code?.excluded).toBe(true);
    expect(html && source.slice(html.start, html.end)).toContain("PRIVATE_RAW_COMMENT_MUST_NOT_BE_RETAINED");
    expect(html?.excluded).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_RAW_CODE_MUST_NOT_BE_RETAINED");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_RAW_COMMENT_MUST_NOT_BE_RETAINED");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_HEADING_MUST_NOT_BE_RETAINED");
    expect(Object.keys(result.spans[0] ?? {}).sort()).toEqual([
      "end", "excluded", "headingPath", "id", "kind", "start", "textHash", "version"
    ]);
  });

  it("does not change legacy requirement extraction when the shadow parser runs", () => {
    const source = "## Requirements\n- Return `Ready` when checks pass.\n\n## Testing\n- pnpm test";

    const before = extractRequirementEvidence("", source, "task");
    parseGeneralPrStructureV1(source);
    const after = extractRequirementEvidence("", source, "task");

    expect(after).toEqual(before);
  });
});
