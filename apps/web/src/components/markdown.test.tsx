import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { imageUrl, Markdown, resolveRelativePath } from "./markdown.js";

describe("resolveRelativePath", () => {
  it("resolves links between files of a mount", () => {
    expect(resolveRelativePath("docs", "getting-started.md")).toBe("docs/getting-started.md");
    expect(resolveRelativePath("docs", "./a/../b.md#section")).toBe("docs/b.md");
    expect(resolveRelativePath("skills/notes", "../../README.md?plain=1")).toBe("README.md");
    expect(resolveRelativePath("", "docs/a%20b.md")).toBe("docs/a b.md");
    expect(resolveRelativePath("team/skills", "/docs/shared.md")).toBe("docs/shared.md");
    expect(resolveRelativePath("docs", "%2e%2e/README.md")).toBe("README.md");
  });

  it("refuses what leaves the repository root or is not a plain path", () => {
    for (const href of [
      "../../secret.md",
      "../../../etc/passwd",
      "//example.com/file.md",
      "%2e%2e/%2e%2e/secret.md",
      "a%2Fb.md",
      "a%5Cb.md",
      "a%00b.md",
      "a\\b.md",
      "%zz.md",
      "",
    ]) {
      expect(resolveRelativePath("docs", href), href).toBeUndefined();
    }
    expect(resolveRelativePath("", "..")).toBeUndefined();
  });
});

describe("imageUrl", () => {
  const host = (path: string) => `https://raw.example/${path}`;

  it("keeps an https picture, and sends a path of the repository to the host", () => {
    expect(imageUrl("https://example.com/a.png", "docs", host)).toBe("https://example.com/a.png");
    expect(imageUrl("../assets/a.png", "docs", host)).toBe("https://raw.example/assets/a.png");
    expect(imageUrl("/assets/a.png", "docs", host)).toBe("https://raw.example/assets/a.png");
  });

  it("loads nothing else", () => {
    for (const source of [
      "http://example.com/a.png",
      "//example.com/a.png",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "../../outside.png",
      "",
      undefined,
    ]) {
      expect(imageUrl(source, "docs", host), String(source)).toBeUndefined();
    }
    // A page with no repository behind it has nowhere to load a path from.
    expect(imageUrl("assets/a.png", "", undefined)).toBeUndefined();
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

  it("does not link references that the server marks outside the connection", () => {
    const html = renderToStaticMarkup(
      <Markdown
        source="[Shared](/shared/guide.md)"
        baseDirectory="team/skills"
        fileHref={(path) => `/gh/acme/skills/team?file=${path}`}
        references={[
          { href: "/shared/guide.md", path: "shared/guide.md", status: "outside_mount" },
        ]}
      />,
    );
    expect(html).toContain("Shared");
    expect(html).not.toContain("href=");
  });

  it("shows pictures from the web and from the host, lazily and without a referrer", () => {
    const html = renderToStaticMarkup(
      <Markdown
        source={[
          "![a diagram](https://example.com/pixel.png)",
          "![local](../assets/local.png)",
          "![plain](http://example.com/plain.png)",
          "![inline](data:image/png;base64,AAAA)",
          "![out](../../outside.png)",
        ].join("\n\n")}
        baseDirectory="docs"
        fileHref={(path) => `/gh/acme/skills?file=${path}`}
        imageSrc={(path) => `https://raw.example/acme/skills/abc/${path}`}
      />,
    );
    const images = html.match(/<img [^>]+>/g) ?? [];
    expect(images).toHaveLength(2);
    expect(images[0]).toContain('src="https://example.com/pixel.png"');
    expect(images[0]).toContain('alt="a diagram"');
    expect(images[1]).toContain('src="https://raw.example/acme/skills/abc/assets/local.png"');
    for (const image of images) {
      expect(image).toContain('loading="lazy"');
      expect(image).toContain('referrerPolicy="no-referrer"');
    }
    // Anything else stands as its text: another scheme, a path that leaves the repository.
    expect(html).not.toContain("plain.png");
    expect(html).not.toContain("data:image");
    expect(html).not.toContain("outside.png");
    for (const text of ["plain", "inline", "out"]) {
      expect(html).toMatch(new RegExp(`<span class="[^"]*">${text}</span>`));
    }
  });

  it("shows a picture of the repository as its text where there is no host to load it from", () => {
    // A page of the deployment's own has no repository behind it.
    const html = render("![a diagram](assets/local.png) ![web](https://example.com/pixel.png)");
    expect(html).not.toContain("local.png");
    expect(html).toContain("a diagram");
    expect(html).toContain('<img src="https://example.com/pixel.png"');
  });

  it("renders tables and task lists", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] open\n");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
  });
});
