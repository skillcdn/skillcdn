import { parseFrontMatter, splitFrontMatter } from "./front-matter.js";
import type { RepoPath } from "./repo-path.js";
import type { SkillDocumentInput } from "./skill-document.js";

/**
 * What the indexer and the reader both start from when they assemble a skill: the source texts.
 * One function turns them into the document's input, so that the digest computed when a commit
 * is indexed is the digest of what is served later.
 */
export interface SkillDocumentSources {
  readonly commit: string;
  /** The skill's own `SKILL.md`: its path and text. */
  readonly skill: { readonly path: RepoPath; readonly text: string };
  /** Readable repository manifests from the repository root to the nearest, with their texts. */
  readonly manifests: readonly { readonly path: RepoPath; readonly text: string }[];
  /** The files the skill includes, in declaration order, with their texts. */
  readonly included: readonly { readonly path: RepoPath; readonly text: string }[];
}

/** `undefined` when the skill's front matter cannot be read: such a skill is not assembled. */
export function skillDocumentInput(sources: SkillDocumentSources): SkillDocumentInput | undefined {
  const split = splitFrontMatter(sources.skill.text);
  if (split.kind !== "found") return undefined;
  const frontMatter = parseFrontMatter(split.source);
  if (!frontMatter.ok) return undefined;
  const rules = sources.manifests.flatMap((manifest) => {
    const parsed = splitFrontMatter(manifest.text);
    const body = parsed.kind === "found" ? parsed.body.trim() : "";
    return body.length === 0 ? [] : [{ path: manifest.path, body }];
  });
  return {
    frontMatter: frontMatter.value,
    commit: sources.commit,
    sources: [
      ...rules.map((rule) => rule.path),
      sources.skill.path,
      ...sources.included.map((file) => file.path),
    ],
    rules,
    body: split.body.trim(),
    included: sources.included.map((file) => ({ path: file.path, content: file.text })),
  };
}
