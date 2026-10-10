// The id of a heading, the way the git host makes one for the same file: lowercased, with
// everything dropped that is not a letter, a number, a mark, a space, a hyphen or an underscore,
// spaces turned into hyphens, and a counter for a repeat. A fragment written for the file at the
// host (`skill-repo.md#licenses`) then names the same heading on the page. The build (dev/docs.ts)
// uses it to check links, and the renderer (components/markdown.tsx) to give the headings their
// ids; both walk the headings in document order, so the counters agree.

const DROPPED = /[^\p{L}\p{N}\p{M} _-]/gu;

/** One slugger per document: the second heading of a name gets `-1`, the third `-2`. */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = text.toLowerCase().replace(DROPPED, "").replace(/ /g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

/**
 * The text of a heading of the Markdown syntax tree: its text and its code, with the markup
 * around them left out, as the host reads it when it makes the id.
 */
export function headingText(node: unknown): string {
  if (typeof node !== "object" || node === null || !("type" in node)) {
    return "";
  }
  if (node.type === "text" || node.type === "inlineCode") {
    return "value" in node && typeof node.value === "string" ? node.value : "";
  }
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(headingText).join("");
  }
  return "";
}
