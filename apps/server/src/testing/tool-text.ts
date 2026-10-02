/**
 * Readers of the text a tool returns, for tests. A tool result is one text block laid out as
 * docs/specs/tools.md says (ADR-0034), so a test takes what it checks from that layout.
 */

/** The text blocks of a tool result, joined. */
export function textOf(result: { readonly content?: unknown }): string {
  const blocks: unknown[] = Array.isArray(result.content) ? result.content : [];
  return blocks
    .map((block) =>
      typeof block === "object" &&
      block !== null &&
      "text" in block &&
      typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("\n");
}

const CONTINUES = "\n(Continues in the next load_skill page.)";
const NOT_AT_HAND = "(Not at hand here; read_repo_file has it.)";

/** The continuation a listing or a skill page names, if any. */
export function continuationOf(text: string): string | undefined {
  const listing = /^nextCursor: (".*")$/m.exec(text);
  if (listing?.[1] !== undefined) return JSON.parse(listing[1]) as string;
  const skill =
    /^Skill context is incomplete\. Continue load_skill with path ".*" and cursor (".*") before using it\.$/m.exec(
      text,
    );
  return skill?.[1] === undefined ? undefined : (JSON.parse(skill[1]) as string);
}

/** The paths of a browse page's entries, or of a search page's results, in page order. */
export function listedPaths(text: string): string[] {
  const paths: string[] = [];
  for (const line of text.split("\n")) {
    const entry = /^- (?:directory|skill|file): ([^\s;]+)/.exec(line);
    const skill = /^\d+\. skill: .* \(((?:[^\s()]+\/)?SKILL\.md)\)/.exec(line);
    const document = /^\d+\. document: (\S+)/.exec(line);
    const path = entry?.[1] ?? skill?.[1] ?? document?.[1];
    if (path !== undefined) paths.push(path);
  }
  return paths;
}

export interface SkillPageSections {
  readonly rules: readonly { path: string; body: string; continues: boolean }[];
  /** The instructions on this page; `undefined` when the page carries none. */
  readonly body: string | undefined;
  readonly included: readonly { path: string; content: string | undefined; continues: boolean }[];
}

/** The context sections of a skill page, exactly as cut: the rules, the instructions, the files. */
export function skillSectionsOf(text: string): SkillPageSections {
  const headers = [
    ...text.matchAll(/^--- (?:applicable rules: (.+)|(instructions)|included file: (.+)) ---$/gm),
  ];
  const tail = ["\n\nResolved references:\n", "\n\nReference list abbreviated"]
    .map((marker) => {
      const last = headers.at(-1);
      return text.indexOf(marker, last === undefined ? 0 : last.index);
    })
    .filter((index) => index >= 0);
  const end = tail.length === 0 ? text.length : Math.min(...tail);
  const rules: { path: string; body: string; continues: boolean }[] = [];
  const included: { path: string; content: string | undefined; continues: boolean }[] = [];
  let body: string | undefined;
  headers.forEach((header, index) => {
    const start = header.index + header[0].length + 1;
    const next = headers[index + 1];
    let content = text.slice(start, next === undefined ? end : next.index - 2);
    const continues = content.endsWith(CONTINUES);
    if (continues) content = content.slice(0, -CONTINUES.length);
    if (header[1] !== undefined) rules.push({ path: header[1], body: content, continues });
    else if (header[2] !== undefined) body = content;
    else if (header[3] !== undefined)
      included.push({
        path: header[3],
        content: content === NOT_AT_HAND ? undefined : content,
        continues,
      });
  });
  return { rules, body, included };
}

export interface FilePage {
  readonly content: string;
  readonly offset: number;
  readonly nextOffset: number | undefined;
  readonly totalLength: number;
}

/** A page of `read_repo_file`: its content and the character range it covers. */
export function filePageOf(text: string): FilePage {
  const range = /^File: \S+ \((?:(\d+) characters|characters (\d+) to \d+ of (\d+))\)$/m.exec(text);
  if (range === null) throw new Error("not a file page");
  const more = /^More follows: call read_repo_file with offset (\d+)\.$/m.exec(text);
  const marker = "--- content ---\n";
  const start = text.indexOf(marker);
  if (start < 0) throw new Error("a file page without content");
  const from = start + marker.length;
  const tail = ["\n\nResolved references:\n", "\n\nReference list abbreviated"]
    .map((candidate) => text.indexOf(candidate, from))
    .filter((index) => index >= 0);
  return {
    content: text.slice(from, tail.length === 0 ? text.length : Math.min(...tail)),
    offset: Number(range[2] ?? 0),
    nextOffset: more?.[1] === undefined ? undefined : Number(more[1]),
    totalLength: Number(range[1] ?? range[3]),
  };
}
