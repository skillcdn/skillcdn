# ADR-0023: Read introductions on demand and make publication exclusions explicit

- Status: Accepted
- Date: 2026-09-24
- Supersedes ADR-0022's availability of skills inside failed manifest scopes. Other decisions remain.

## Context

Real repositories commonly describe their purpose and skill organization in READMEs without a manifest. Folder names alone provide little orientation, while loading the entire introduction for every connection wastes context. Item-count limits also permit large tool responses when descriptions are long. Discovering declared skills under hidden ancestors means a hidden test directory is no longer a reliable way to keep fixtures out of the served set.

## Decision

1. Offer one original README as an optional overview at the repository root and in folders already exposed by eligible content. Discovery carries a short summary and path; `read_file` retrieves the body when needed. Explicit manifest metadata takes precedence. Local README summaries, then the git-host description at the repository root, provide fallback orientation. Overview eligibility alone does not add search results or document counts. Ordinary bounded Markdown references still apply.
2. Keep the four existing tools. Bound the serialized MCP result, including both representations, rather than only the number of items or the unwrapped body. Discovery uses brief summaries and continuation pages; required skill context and raw file text remain complete across pages. A README is never an inherited rule or automatic skill include. UI language does not select translated agent content.
3. Add manifest-relative `exclude` paths for exact files or subtrees, with `.` for the manifest's own scope. Exclusions accumulate from ancestors and override every route, including valid hidden skills, documents, overviews, includes, links and direct reads. No folder-name heuristics, globs or negation. Keep test policies inside their fixture root instead of adding unrelated repository-wide metadata.
4. Fail publication policies closed. A malformed or unreadable manifest closes its descendant scope and reports its own diagnostic; nested declarations cannot reopen it. Raw reads wait for a known publication policy by returning the indexing state until the index is ready.

## Consequences

Unmodified skill repositories gain optional orientation without extra tools or automatic body loading. Authors can control publication independently of filesystem visibility. Local `check`, MCP, REST and the explorer share the same exclusions and README selection. Reading-rule versioning invalidates older snapshots and cursors.

The pre-alpha reading contract becomes stricter for failed manifests and reads before indexing. This explicit transition prevents speculative reads from bypassing an unknown exclusion. The complete rules and limits live in [the format](../specs/skill-repo.md), [tools](../specs/tools.md) and [REST](../specs/rest.md).
