import { splitFrontMatter } from "./front-matter.js";
import { parentDirectory } from "./repo-layout.js";
import { MAX_REPO_PATH_LENGTH, parseRepoPath, type RepoPath } from "./repo-path.js";

/** Work bounds for untrusted Markdown; these are independent of the repository size. */
export const MAX_MARKDOWN_REFERENCES = 200;
export const MAX_LINK_MARKDOWN_LENGTH = 262_144;

export interface MarkdownReference {
  /** The author's destination, including any fragment. */
  readonly href: string;
  /** The resolved path from the repository root, with no fragment. */
  readonly path: RepoPath;
}

export interface MarkdownReferenceInspection {
  readonly references: readonly MarkdownReference[];
  /** True when input or reference limits prevented inspecting every local link. */
  readonly truncated: boolean;
}

/** Resolve one local Markdown destination, decoding it once and never escaping the repository. */
export function resolveMarkdownReference(source: RepoPath, href: string): RepoPath | undefined {
  if (href.length === 0 || href.length > MAX_REPO_PATH_LENGTH || href.startsWith("#")) {
    return undefined;
  }
  let destination: string;
  try {
    destination = decodeURIComponent(href.split(/[?#]/, 1)[0] ?? "");
  } catch {
    return undefined;
  }
  if (
    destination.length === 0 ||
    destination.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(destination) ||
    !destination.toLowerCase().endsWith(".md")
  ) {
    return undefined;
  }
  const directory = parentDirectory(source);
  const segments =
    destination.startsWith("/") || directory.length === 0 ? [] : directory.split("/");
  for (const segment of destination.replace(/^\//, "").split("/")) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  const parsed = parseRepoPath(segments.join("/"));
  return parsed.ok ? parsed.value : undefined;
}

/** Remove code and front-matter before interpreting link syntax. */
function prose(markdown: string): string {
  const split = splitFrontMatter(markdown);
  const body = split.kind === "found" ? split.body : markdown;
  let fence: { marker: string; length: number } | undefined;
  const lines = body.split("\n").map((line) => {
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== undefined) {
      if (
        opening?.[1]?.[0] === fence.marker &&
        opening[1].length >= fence.length &&
        line.slice(opening[0].length).trim().length === 0
      ) {
        fence = undefined;
      }
      return "";
    }
    if (opening?.[1] !== undefined) {
      fence = { marker: opening[1][0] ?? "`", length: opening[1].length };
      return "";
    }
    return /^( {4}|\t)/.test(line) ? "" : line;
  });
  return withoutCodeSpans(
    lines.join("\n").replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => " ".repeat(comment.length)),
  );
}

/** Match whole delimiter runs, with linear work even when no delimiter has a closing run. */
function withoutCodeSpans(text: string): string {
  const runs = Array.from(text.matchAll(/`+/g), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
    next: undefined as number | undefined,
    escapedNext: undefined as number | undefined,
  }));
  const nextByLength = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run === undefined) continue;
    const length = run.end - run.start;
    run.next = nextByLength.get(length);
    // Outside a span, an escape consumes only the first backtick of an opening run.
    run.escapedNext = nextByLength.get(length - 1);
    nextByLength.set(length, index);
  }
  const parts: string[] = [];
  let copiedThrough = 0;
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (run === undefined) continue;
    const openingEscaped = escaped(text, run.start);
    const closingIndex = openingEscaped ? run.escapedNext : run.next;
    const closing = closingIndex === undefined ? undefined : runs[closingIndex];
    if (closing === undefined || closingIndex === undefined) continue;
    const start = run.start + Number(openingEscaped);
    parts.push(text.slice(copiedThrough, start), " ".repeat(closing.end - start));
    copiedThrough = closing.end;
    index = closingIndex;
  }
  parts.push(text.slice(copiedThrough));
  return parts.join("");
}

function escaped(text: string, at: number): boolean {
  let slashes = 0;
  while (at > 0 && text[at - 1] === "\\") {
    slashes += 1;
    at -= 1;
  }
  return slashes % 2 === 1;
}

/** A bounded destination reader, including balanced parentheses and angle destinations. */
function destinationAt(text: string, start: number): { href: string; end: number } | undefined {
  let at = start;
  while (at < text.length && /\s/.test(text[at] ?? "")) at += 1;
  const angle = text[at] === "<";
  if (angle) at += 1;
  const from = at;
  let depth = 0;
  for (; at < text.length && at - from <= MAX_REPO_PATH_LENGTH; at += 1) {
    const char = text[at];
    if (char === "\\" && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(text[at + 1] ?? "")) {
      at += 1;
      continue;
    }
    if (angle ? char === ">" : /\s/.test(char ?? "") || (char === ")" && depth === 0)) {
      const href = text.slice(from, at).replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1");
      return href.length === 0 ? undefined : { href, end: angle ? at + 1 : at };
    }
    if (!angle && char === "(") depth += 1;
    if (!angle && char === ")") depth -= 1;
    if (angle && (char === "\n" || char === "<")) return undefined;
  }
  return !angle && depth === 0 && at === text.length && at > from
    ? { href: text.slice(from, at), end: at }
    : undefined;
}

const labelKey = (label: string): string => label.trim().replace(/\s+/g, " ").toLowerCase();

const MAX_LABEL_LENGTH = 999;

/**
 * Every `[label]` whose label has one to {@link MAX_LABEL_LENGTH} characters and no closing
 * bracket or line break inside, left to right and without overlap: what the pattern
 * `\[([^\]\n]{1,999})\]` finds, in linear time. The pattern itself rescans up to the length bound
 * from every opening bracket, which a text of brackets that never close turns into a quadratic
 * cost; here the next closing bracket and line break are found once and reused.
 */
function* bracketedLabels(
  text: string,
): Generator<{ readonly index: number; readonly end: number; readonly label: string }> {
  // The end of the text stands for "none", so that a search that found nothing is not repeated.
  const nextOrEnd = (needle: string, from: number): number => {
    const found = text.indexOf(needle, from);
    return found < 0 ? text.length : found;
  };
  let closing = -1;
  let lineBreak = -1;
  let at = text.indexOf("[");
  while (at >= 0) {
    if (closing < at) closing = nextOrEnd("]", at + 1);
    if (closing === text.length) return;
    if (lineBreak < at) lineBreak = nextOrEnd("\n", at + 1);
    const length = closing - at - 1;
    if (length >= 1 && length <= MAX_LABEL_LENGTH && lineBreak > closing) {
      yield { index: at, end: closing + 1, label: text.slice(at + 1, closing) };
      at = text.indexOf("[", closing + 1);
    } else {
      at = text.indexOf("[", at + 1);
    }
  }
}

/**
 * Local .md links in prose: inline, full/collapsed reference, and shortcut reference links.
 * Images, code, external URLs, malformed encodings and paths outside the repository are ignored.
 * This intentionally does not interpret HTML or bare filenames as publication declarations.
 */
export function extractMarkdownReferences(
  source: RepoPath,
  markdown: string,
): readonly MarkdownReference[] {
  return inspectMarkdownReferences(source, markdown).references;
}

/** Inspect references without silently presenting a bounded result as complete. */
export function inspectMarkdownReferences(
  source: RepoPath,
  markdown: string,
): MarkdownReferenceInspection {
  if (markdown.length > MAX_LINK_MARKDOWN_LENGTH) return { references: [], truncated: true };
  const text = prose(markdown);
  const definitions = new Map<string, string>();
  const withoutDefinitions = text.replace(
    /^ {0,3}\[([^\]\n]{1,999})\]:([^\n]*)$/gm,
    (line: string, label: string, rest: string) => {
      const found = destinationAt(rest, 0);
      const key = labelKey(label);
      if (found !== undefined && !definitions.has(key)) definitions.set(key, found.href);
      return " ".repeat(line.length);
    },
  );
  const references: MarkdownReference[] = [];
  const seen = new Set<string>();
  for (const match of bracketedLabels(withoutDefinitions)) {
    const at = match.index;
    if (
      escaped(withoutDefinitions, at) ||
      withoutDefinitions[at - 1] === "!" ||
      withoutDefinitions[at - 1] === "]"
    )
      continue;
    const after = match.end;
    let href: string | undefined;
    if (withoutDefinitions[after] === "(") {
      const found = destinationAt(withoutDefinitions, after + 1);
      if (
        found !== undefined &&
        /^\s*(?:"[^"\n]*"|'[^'\n]*'|\([^\n]*\))?\s*\)/.test(
          withoutDefinitions.slice(found.end, found.end + 2048),
        )
      ) {
        href = found.href;
      }
    } else if (withoutDefinitions[after] === "[") {
      const reference = /^\[([^\]\n]{0,999})\]/.exec(withoutDefinitions.slice(after, after + 1001));
      if (reference !== null) href = definitions.get(labelKey(reference[1] || match.label));
    } else {
      href = definitions.get(labelKey(match.label));
    }
    if (href === undefined || seen.has(href)) continue;
    const path = resolveMarkdownReference(source, href);
    if (path !== undefined) {
      if (references.length >= MAX_MARKDOWN_REFERENCES) return { references, truncated: true };
      seen.add(href);
      references.push({ href, path });
    }
  }
  return { references, truncated: false };
}
