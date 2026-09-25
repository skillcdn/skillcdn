/**
 * The wire form of a skill: a plain Agent Skills `SKILL.md` assembled from its sources
 * (ADR-0025). The front matter of the source is re-serialized without what SkillCDN adds, a
 * line names the files and the commit it was assembled from, then come the rules of the
 * repository manifests from the root down, the skill's own body, and the files it includes. The
 * same text goes through the skills extension and through `load_skill`, and its digest is what
 * the listing declares.
 */

/** The front-matter key that holds what SkillCDN adds; it stays in the source and leaves the wire. */
export const SKILLCDN_KEY = "skillcdn";

export interface SkillRulesSection {
  readonly path: string;
  readonly body: string;
  /** True when a page ends before the body is complete. */
  readonly truncated?: boolean;
}

export interface IncludedFileSection {
  readonly path: string;
  /** `undefined` when the file is not at hand: not indexed, or over the limits. */
  readonly content: string | undefined;
  readonly truncated?: boolean;
}

export interface SkillSections {
  readonly rules: readonly SkillRulesSection[];
  readonly body: string;
  readonly included: readonly IncludedFileSection[];
}

export interface SkillDocumentInput extends SkillSections {
  /**
   * The parsed front matter of the source, as the failsafe parser returns it: strings,
   * sequences and mappings, in the author's order.
   */
  readonly frontMatter: ReadonlyMap<string, unknown>;
  /** The commit the document is assembled from, and the source files in the order they are used. */
  readonly commit: string;
  readonly sources: readonly string[];
}

const RESERVED_PLAIN_KEYS = new Set(["true", "false", "null", "yes", "no", "on", "off", "~"]);
const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** A YAML double-quoted scalar; JSON's escapes are a subset of YAML's. */
function quoted(value: string): string {
  return JSON.stringify(value);
}

function keyOf(key: string): string {
  return PLAIN_KEY.test(key) && !RESERVED_PLAIN_KEYS.has(key.toLowerCase()) ? key : quoted(key);
}

/** One YAML node at `indent`, every scalar quoted, so that no reader can mistake its type. */
function yamlLines(value: unknown, indent: string): string[] {
  if (value instanceof Map) {
    if (value.size === 0) return [`${indent}{}`];
    return [...value.entries()].flatMap(([key, entry]) => {
      const nested = yamlLines(entry, `${indent}  `);
      return isScalar(entry)
        ? [`${indent}${keyOf(String(key))}: ${nested[0]?.trim() ?? '""'}`]
        : [`${indent}${keyOf(String(key))}:`, ...nested];
    });
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}[]`];
    return value.flatMap((item) => {
      const nested = yamlLines(item, `${indent}  `);
      return isScalar(item)
        ? [`${indent}- ${nested[0]?.trim() ?? '""'}`]
        : [`${indent}-`, ...nested];
    });
  }
  return [`${indent}${quoted(value === undefined || value === null ? "" : String(value))}`];
}

function isScalar(value: unknown): boolean {
  return !(value instanceof Map) && !Array.isArray(value);
}

/** The front matter as it is served: the author's fields, quoted, without SkillCDN's own key. */
export function serializeFrontMatter(frontMatter: ReadonlyMap<string, unknown>): string {
  const served = new Map([...frontMatter].filter(([key]) => key !== SKILLCDN_KEY));
  return yamlLines(served, "").join("\n");
}

/** The served front matter as data, for a listing to declare what a reader will parse. */
export function frontMatterObject(
  frontMatter: ReadonlyMap<string, unknown>,
): Record<string, unknown> {
  const toData = (value: unknown): unknown => {
    if (value instanceof Map) {
      return Object.fromEntries(
        [...value.entries()].map(([key, entry]) => [String(key), toData(entry)]),
      );
    }
    if (Array.isArray(value)) return value.map(toData);
    return value === undefined || value === null ? "" : String(value);
  };
  const data = toData(new Map([...frontMatter].filter(([key]) => key !== SKILLCDN_KEY)));
  return data as Record<string, unknown>;
}

function listOfPaths(paths: readonly string[]): string {
  const named = paths.map((path) => `\`${path}\``);
  if (named.length <= 1) return named.join("");
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/**
 * The sections of a skill as a model reads them, in the order the author meant them to be read:
 * the rules that hold for the skill, then its instructions, then the files it needs on every run.
 * `continuation` names the tool whose next page completes a section that was cut.
 */
export function renderSkillSections(
  sections: SkillSections,
  continuation?: { readonly tool: string; readonly reader: string },
): string {
  const parts: string[] = [];
  for (const rule of sections.rules) {
    const cut =
      rule.truncated === true && continuation !== undefined
        ? `\n(Continues in the next ${continuation.tool} page.)`
        : "";
    parts.push(`--- applicable rules: ${rule.path} ---\n${rule.body}${cut}`);
  }
  if (sections.body.length > 0) {
    parts.push(`--- instructions ---\n${sections.body}`);
  }
  for (const file of sections.included) {
    const header = `--- included file: ${file.path} ---`;
    if (file.content === undefined) {
      parts.push(
        `${header}\n(Not at hand here${continuation === undefined ? "" : `; ${continuation.reader} has it`}.)`,
      );
      continue;
    }
    const cut =
      file.truncated === true && continuation !== undefined
        ? `\n(Continues in the next ${continuation.tool} page.)`
        : "";
    parts.push(`${header}\n${file.content}${cut}`);
  }
  return parts.join("\n\n");
}

/** The line that says where the document came from; it opens the body of every served skill. */
export function provenanceLine(commit: string, sources: readonly string[]): string {
  return `> Assembled by SkillCDN from ${listOfPaths(sources)} at commit \`${commit}\`.`;
}

/** The complete document, ending in one line break. Deterministic: the same input, the same bytes. */
export function assembleSkillDocument(input: SkillDocumentInput): string {
  const sections = renderSkillSections(input);
  return `---\n${serializeFrontMatter(input.frontMatter)}\n---\n${provenanceLine(input.commit, input.sources)}${sections.length === 0 ? "" : `\n\n${sections}`}\n`;
}
