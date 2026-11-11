import { type MarkdownOutline, type OutlineHeading, outlineMarkdown } from "./outline.js";

// The fragment of a link names a section of the file it points to (ADR-0082): `guide.md#4.2.7`
// is the section headed `4.2.7 Detection of carrier loss`, with the sections under it. A long
// document refers to its own parts by number hundreds of times; resolved to the offset and the
// length that read the section, a reference is followed in one read of a few thousand characters
// instead of the file it stands in.

/** The characters that read a section: what `read_repo_file` takes as `offset` and `limit`. */
export interface SectionRange {
  readonly offset: number;
  readonly length: number;
}

/** A fragment longer than this names nothing. */
const MAX_FRAGMENT_LENGTH = 300;

/** What stands around a word of a heading without being part of it. */
const EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
/** What a word of a slug keeps inside it: letters, digits, and the dots, hyphens and underscores that join them. */
const NOT_SLUG = /[^\p{L}\p{N}._-]+/gu;

/**
 * A heading as a fragment names it: its words in lower case, each without the marks around it,
 * joined by hyphens. `4.2.7 Detection of carrier loss` is `4.2.7-detection-of-carrier-loss`, and
 * `TABLE C-2: Modifier codes` is `table-c-2-modifier-codes`.
 */
export function headingSlug(heading: string): string {
  return slugWords(heading).join("-");
}

/** The words of a heading as its slug joins them. */
function slugWords(heading: string): string[] {
  return heading
    .toLowerCase()
    .split(/\s+/u)
    .map((word) => word.replace(EDGES, "").replace(NOT_SLUG, ""))
    .filter((word) => word.length > 0);
}

/** A heading as a fragment is held against it: its slug, and where each of its words ends in the slug. */
interface NamedHeading {
  readonly slug: string;
  readonly ends: ReadonlySet<number>;
  readonly host: string;
}

function namedHeading(heading: string): NamedHeading {
  const words = slugWords(heading);
  const ends = new Set<number>();
  let length = -1;
  for (const word of words) {
    length += word.length + 1;
    ends.add(length);
  }
  return { slug: words.join("-"), ends, host: hostSlug(heading) };
}

/**
 * A heading as the renderers of the git hosts name it: lower case, everything but letters,
 * digits, blanks, hyphens and underscores removed, blanks as hyphens. `4.2.7 Detection of
 * carrier loss` is `427-detection-of-carrier-loss`: a link written by such a renderer's rule
 * names its section too.
 */
function hostSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "")
    .trim()
    .replace(/\s/gu, "-");
}

/** A fragment as it is held against a slug: decoded once, in lower case. */
function normalized(fragment: string): string | undefined {
  if (fragment.length === 0 || fragment.length > MAX_FRAGMENT_LENGTH) {
    return undefined;
  }
  try {
    return decodeURIComponent(fragment).toLowerCase();
  } catch {
    return fragment.toLowerCase();
  }
}

/**
 * Whether a fragment names a heading: it is the words the heading's slug begins with, ending
 * where a word of the heading ends; or it is the slug a git host's renderer makes. `4.2.7` names
 * `4.2.7 Detection of carrier loss` and not `4.2.7.1 Counting`; `table-c-2` names
 * `TABLE C-2 Modifier codes: AA to BZ`, and `table-c` does not, since `C-2` is one word.
 */
function names(fragment: string, heading: NamedHeading): boolean {
  return (
    (heading.ends.has(fragment.length) && heading.slug.startsWith(fragment)) ||
    (heading.host.length > 0 && heading.host === fragment)
  );
}

/** From a heading to the next heading of its level or above, or to the end: the section with what stands under it. */
function rangeOf(headings: readonly OutlineHeading[], at: number, end: number): SectionRange {
  const heading = headings[at];
  if (heading === undefined) {
    return { offset: 0, length: end };
  }
  let next = at + 1;
  while (next < headings.length && (headings[next]?.level ?? 0) > heading.level) {
    next += 1;
  }
  return { offset: heading.offset, length: (headings[next]?.offset ?? end) - heading.offset };
}

/**
 * What resolves the fragments of the links to one Markdown document: given a fragment, the
 * section it names, the first heading the fragment names with every section under it; else the
 * section in which an anchor of that name stands (`<a id="...">`, `name="..."`), as converters
 * write one; else nothing. The headings are read once, however many fragments are asked for.
 */
export function fragmentResolver(
  text: string,
  outline?: MarkdownOutline,
): (fragment: string) => SectionRange | undefined {
  const { headings, totalLength } = outline ?? outlineMarkdown(text);
  const named = headings.map((heading) => namedHeading(heading.text));
  /** The explicit anchors of the document, read when a fragment first names no heading. */
  let anchors: Map<string, number> | undefined;
  return (fragment) => {
    const wanted = normalized(fragment);
    if (wanted === undefined) {
      return undefined;
    }
    for (const [at, heading] of named.entries()) {
      if (names(wanted, heading)) {
        return rangeOf(headings, at, totalLength);
      }
    }
    // An explicit anchor, written with the fragment as it is: the section it stands in.
    anchors ??= anchorsOf(text);
    const anchor = anchors.get(fragment);
    if (anchor === undefined) {
      return undefined;
    }
    let holder = -1;
    for (let index = 0; index < headings.length; index += 1) {
      if ((headings[index]?.offset ?? 0) > anchor) {
        break;
      }
      holder = index;
    }
    return holder < 0
      ? { offset: 0, length: headings[0]?.offset ?? totalLength }
      : rangeOf(headings, holder, totalLength);
  };
}

/** How many anchors of one document are remembered; a document with more is told of its first. */
const MAX_ANCHORS = 5000;
/** `id="name"` or `name='name'`, as an anchor is written into a document. */
const ANCHOR = /\b(?:id|name)=(["'])([^"'\s<>]{1,300})\1/g;

/** Where each explicit anchor of a document stands, by its name, the first of each: read in one pass. */
function anchorsOf(text: string): Map<string, number> {
  const anchors = new Map<string, number>();
  for (const match of text.matchAll(ANCHOR)) {
    const name = match[2];
    if (name !== undefined && !anchors.has(name)) {
      anchors.set(name, match.index);
      if (anchors.size >= MAX_ANCHORS) {
        break;
      }
    }
  }
  return anchors;
}

/** The section of a Markdown document a fragment names, or nothing ({@link fragmentResolver}). */
export function sectionOfFragment(
  text: string,
  fragment: string,
  outline?: MarkdownOutline,
): SectionRange | undefined {
  return fragmentResolver(text, outline)(fragment);
}
