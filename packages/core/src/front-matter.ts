import { parseDocument, visit } from "yaml";
import { err, ok, type Result } from "./result.js";

export const MAX_FRONT_MATTER_LENGTH = 16_384;

export type FrontMatterSplit =
  | { readonly kind: "none"; readonly body: string }
  | { readonly kind: "unterminated" }
  | { readonly kind: "found"; readonly source: string; readonly body: string };

const BYTE_ORDER_MARK = 0xfeff;

function isDelimiterLine(line: string, delimiters: readonly string[]): boolean {
  return delimiters.includes(line.trimEnd());
}

/**
 * Splits a Markdown file into its YAML front-matter and its body. Front-matter starts on the very
 * first line with `---` and ends at the next line that is `---` or `...`. Linear in the input.
 */
export function splitFrontMatter(text: string): FrontMatterSplit {
  const content = text.codePointAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
  const firstBreak = content.indexOf("\n");
  const firstLine = firstBreak < 0 ? content : content.slice(0, firstBreak);
  if (firstBreak < 0 || !isDelimiterLine(firstLine, ["---"])) {
    return { kind: "none", body: content };
  }

  let lineStart = firstBreak + 1;
  while (lineStart <= content.length) {
    const lineBreak = content.indexOf("\n", lineStart);
    const lineEnd = lineBreak < 0 ? content.length : lineBreak;
    if (isDelimiterLine(content.slice(lineStart, lineEnd), ["---", "..."])) {
      return {
        kind: "found",
        source: content.slice(firstBreak + 1, lineStart),
        body: lineBreak < 0 ? "" : content.slice(lineBreak + 1),
      };
    }
    if (lineBreak < 0) {
      break;
    }
    lineStart = lineBreak + 1;
  }
  return { kind: "unterminated" };
}

export type FrontMatterErrorCode = "too_large" | "invalid_yaml" | "not_a_mapping";

export interface FrontMatterError {
  readonly code: FrontMatterErrorCode;
  readonly message: string;
}

/**
 * Parses front-matter as data and nothing else: the failsafe schema (strings, mappings and
 * sequences only, so `1.0` and `no` stay the strings the author typed), no explicit tags, no
 * aliases, unique string keys, and mappings returned as `Map` so that no key can reach a prototype.
 */
export function parseFrontMatter(
  source: string,
): Result<ReadonlyMap<string, unknown>, FrontMatterError> {
  if (source.length > MAX_FRONT_MATTER_LENGTH) {
    return err({
      code: "too_large",
      message: `front-matter is longer than ${MAX_FRONT_MATTER_LENGTH} characters`,
    });
  }
  let value: unknown;
  try {
    const document = parseDocument(source, {
      schema: "failsafe",
      version: "1.2",
      customTags: [],
      merge: false,
      strict: true,
      stringKeys: true,
      uniqueKeys: true,
      prettyErrors: false,
      // "silent" would also silence the error for a second document in the source.
      logLevel: "error",
    });
    const [problem] = document.errors;
    if (problem !== undefined) {
      return err({
        code: "invalid_yaml",
        message: `front-matter is not valid YAML (${problem.code})`,
      });
    }
    // The library resolves well-known tags (timestamps, binary, sets) under any schema.
    let tagged = false;
    visit(document, {
      Node: (_key, node) => {
        if (node.tag !== undefined) {
          tagged = true;
          return visit.BREAK;
        }
        return undefined;
      },
    });
    if (tagged) {
      return err({ code: "invalid_yaml", message: "front-matter must not use YAML tags" });
    }
    value = document.toJS({ mapAsMap: true, maxAliasCount: 0 });
  } catch {
    // Aliases, and nesting deep enough to exhaust the parser's stack, end up here.
    return err({ code: "invalid_yaml", message: "front-matter is not valid YAML" });
  }
  if (value === null || value === undefined) {
    return ok(new Map());
  }
  if (!(value instanceof Map)) {
    return err({ code: "not_a_mapping", message: "front-matter must be a YAML mapping" });
  }
  return ok(value);
}
