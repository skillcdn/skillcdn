import type { IncludedFile, SkillResult, SkillRules } from "./results.js";

// A skill is read in pages of its context (docs/specs/tools.md): the rules, the body and the
// included files, each of which a page may end inside. A program that reads every page gives
// the agent the skill whole; this joins the pages back into the one result they were cut from.

/** Fragments of one text in page order, joined: a later fragment of a path continues the one before it. */
function joinFragments<T extends { readonly path: unknown; readonly truncated: boolean }>(
  pages: readonly (readonly T[])[],
  textOf: (fragment: T) => string,
  withText: (fragment: T, text: string, truncated: boolean) => T,
): T[] {
  const joined: T[] = [];
  for (const page of pages) {
    for (const fragment of page) {
      const last = joined[joined.length - 1];
      if (last?.truncated && last.path === fragment.path) {
        joined[joined.length - 1] = withText(
          last,
          `${textOf(last)}${textOf(fragment)}`,
          fragment.truncated,
        );
      } else {
        joined.push(fragment);
      }
    }
  }
  return joined;
}

/**
 * The pages of one skill, read in order with the cursor each one gave, as the whole skill: the
 * first page's facts, every fragment of the rules, the body and the included files joined, and
 * the last page's word on whether the skill is complete. `undefined` without a page.
 */
export function joinSkillPages(pages: readonly SkillResult[]): SkillResult | undefined {
  const [first] = pages;
  const last = pages[pages.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }
  const ruleChain = joinFragments<SkillRules>(
    pages.map((page) => page.ruleChain ?? []),
    (rule) => rule.body,
    (rule, body, truncated) => ({ ...rule, body, truncated }),
  );
  const included = joinFragments<IncludedFile>(
    pages.map((page) => page.included),
    (file) => file.content ?? "",
    (file, content, truncated) => ({ ...file, content, truncated }),
  );
  const warnings = [...new Set(pages.flatMap((page) => page.warnings))];
  return {
    ...first,
    ruleChain,
    body: pages.map((page) => page.body).join(""),
    included,
    warnings,
    rules: ruleChain[0],
    complete: last.complete,
    nextCursor: last.nextCursor,
  };
}
