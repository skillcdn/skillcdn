import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// src/styles/pretendard.css is generated and committed. These are the promises it makes: it draws
// Hangul and nothing else, it says what the installed package says, and every file it asks for
// is there. A package bump without `pnpm --filter @skillcdn/web run generate:fonts` fails here.

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("pretendard/package.json"));
const here = dirname(fileURLToPath(import.meta.url));

const generated = readFileSync(join(here, "../src/styles/pretendard.css"), "utf8");
const packaged = readFileSync(
  join(packageRoot, "dist/web/variable/pretendardvariable-dynamic-subset.css"),
  "utf8",
);

const HANGUL: readonly (readonly [number, number])[] = [
  [0x1100, 0x11ff],
  [0x3130, 0x318f],
  [0xa960, 0xa97f],
  [0xac00, 0xd7ff],
  [0xffa0, 0xffdc],
];

function faces(css: string): string[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1] ?? "");
}

function ranges(face: string): [number, number][] {
  const declared = /unicode-range:([^;]*);/.exec(face)?.[1] ?? "";
  return [...declared.matchAll(/U\+([0-9a-f]+)(?:-([0-9a-f]+))?/gi)].map((match) => [
    Number.parseInt(match[1] ?? "0", 16),
    Number.parseInt(match[2] ?? match[1] ?? "0", 16),
  ]);
}

const isHangul = ([from, to]: [number, number]): boolean =>
  HANGUL.some(([start, end]) => from >= start && to <= end);

describe("the generated Pretendard style sheet", () => {
  it("asks for Hangul and nothing else", () => {
    const declared = faces(generated).flatMap(ranges);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((range) => !isHangul(range))).toEqual([]);
  });

  it("has a face for every subset of the installed package that carries Hangul", () => {
    const withHangul = faces(packaged).filter((face) =>
      ranges(face).some((range) =>
        HANGUL.some(([start, end]) => range[0] <= end && start <= range[1]),
      ),
    );
    expect(faces(generated)).toHaveLength(withHangul.length);
  });

  it("ships the license of the font next to it", () => {
    // The Open Font License asks for its text and the copyright notices to travel with the font
    // files; the web build carries them as public/licenses/pretendard.txt.
    const notice = readFileSync(join(here, "../public/licenses/pretendard.txt"), "utf8");
    expect(notice).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(notice).toContain("Reserved Font Name 'Pretendard'");
    expect(notice).toContain("PERMISSION & CONDITIONS");
  });

  it("points at files the package ships", () => {
    const urls = [...generated.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1] ?? "");
    expect(urls).toHaveLength(faces(generated).length);
    for (const url of urls) {
      expect(url.startsWith("pretendard/")).toBe(true);
      expect(() => readFileSync(join(packageRoot, url.slice("pretendard/".length)))).not.toThrow();
    }
  });
});
