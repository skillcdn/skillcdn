import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown, resolveRelativePath } from "./markdown.js";

describe("resolveRelativePath", () => {
  it("resolves links between files of a mount", () => {
    expect(resolveRelativePath("docs", "getting-started.md")).toBe("docs/getting-started.md");
    expect(resolveRelativePath("docs", "./a/../b.md#section")).toBe("docs/b.md");
    expect(resolveRelativePath("skills/notes", "../../README.md?plain=1")).toBe("README.md");
    expect(resolveRelativePath("", "docs/a%20b.md")).toBe("docs/a b.md");
  });

  it("refuses what leaves the mounted root or is not a plain path", () => {
    for (const href of [
      "../../secret.md",
      "../../../etc/passwd",
      "/etc/passwd",
      "a\\b.md",
      "%zz.md",
      "",
    ]) {
      expect(resolveRelativePath("docs", href), href).toBeUndefined();
    }
    expect(resolveRelativePath("", "..")).toBeUndefined();
  });
});

describe("Markdown", () => {
  const render = (source: string) =>
    renderToStaticMarkup(
      <Markdown
        source={source}
        baseDirectory="docs"
        fileHref={(path) => `/gh/acme/skills?file=${path}`}
      />,
    );

  it("treats repository content as text, never as markup", () => {
    const html = render(
      'Hello <script>alert(1)</script> <img src=x onerror="alert(2)"> <b>bold</b>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("lets links go to the web or to files of the mount, and nowhere else", () => {
    const html = render(
      [
        "[web](https://example.com/a)",
        "[mail](mailto:someone@example.com)",
        "[file](guide.md)",
        "[up](../README.md)",
        "[out](../../outside.md)",
        "[script](javascript:alert(1))",
        "[data](data:text/html;base64,PHNjcmlwdD4=)",
        "[vb](vbscript:msgbox)",
        "[anchor](#section)",
      ].join("\n\n"),
    );
    expect(html).toContain(
      'href="https://example.com/a" target="_blank" rel="noopener noreferrer nofollow ugc"',
    );
    expect(html).toContain('href="mailto:someone@example.com"');
    expect(html).toContain('href="/gh/acme/skills?file=docs%2Fguide.md"');
    expect(html).toContain('href="/gh/acme/skills?file=README.md"');
    expect(html).toContain('href="#section"');
    expect(html).not.toContain("outside.md");
    expect(html).not.toMatch(/href="(javascript|data|vbscript):/i);
    expect(html).toContain("<span>script</span>");
  });

  it("never loads an image", () => {
    const html = render("![a diagram](https://example.com/pixel.png) ![](local.png)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("pixel.png");
    expect(html).toContain("a diagram");
  });

  it("renders tables and task lists", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] open\n");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
  });
});
