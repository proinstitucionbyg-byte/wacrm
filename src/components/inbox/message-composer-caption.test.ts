import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Guard the actual attachment field: a single-line input strips pasted newlines
// before React's onChange receives them.
describe("campo del texto adjunto", () => {
  it("usa textarea para conservar las lineas del texto pegado", () => {
    const source = readFileSync(new URL("./message-composer.tsx", import.meta.url), "utf8");
    const ast = ts.createSourceFile("message-composer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fields: ts.JsxOpeningLikeElement[] = [];
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const value = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "value");
        if (value?.getText(ast) === "value={draft.caption}") fields.push(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    expect(fields).toHaveLength(1);
    expect(fields[0].tagName.getText(ast)).toBe("textarea");
    expect(fields[0].getText(ast)).toContain("onCaptionChange(e.target.value)");
    expect(fields[0].getText(ast)).toContain("maxLength={MEDIA_CAPTION_MAX}");
    expect(fields[0].getText(ast)).toContain("!e.shiftKey");
  });
});
