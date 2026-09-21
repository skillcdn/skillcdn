# Spec: address scheme

- Status: **Draft.** Normative once milestone 1 ships; until then expect changes.
- Implemented by: `packages/core` (parser and formatter). Nothing else parses addresses.

An address identifies what an agent mounts. It is the path of the MCP endpoint URL, so the whole onboarding is one URL.

```
https://<service-host>/<git-host>/<owner>/<repo>[@<ref>][/<path>]

/gh/<owner>/<repo>                    default branch, latest commit
/gh/<owner>/<repo>@v1.2.0             a tag or a commit
/gh/<owner>/<repo>@main/skills/ads    a sub-path inside the repo
```

## Components

| Part | Meaning | Rules |
|---|---|---|
| `<git-host>` | Which host adapter serves the repo. | `gh` is GitHub, the only value in v0. Other values are reserved for further adapters. |
| `<owner>`, `<repo>` | Repository coordinates on the host. | Validated against the host's naming rules before any network call. Matched case-insensitively where the host does. |
| `@<ref>` | Branch, tag or commit. Optional. | Omitted means the default branch. A full commit hash is *pinned*; everything else is *moving*. |
| `/<path>` | Directory inside the repo to mount. Optional. | Normalized, relative, never escapes the repo root. `.` and `..` segments, backslashes, empty segments and control characters are rejected, not repaired. |

## Semantics

- **Pinned** addresses (full commit hash) always serve the same content and may be cached indefinitely.
- **Moving** addresses resolve to a commit at request time. Resolution is cached briefly and invalidated by push webhooks where the App is installed.
- The parser is pure and total: every input yields either a parsed address or a typed error. It never throws on hostile input and never touches the network.
- Parsing and formatting round-trip: `format(parse(x))` is the canonical form of `x`.

## Open questions

- **Ref versus path ambiguity.** Branch names may contain `/`, so `@feature/x/skills` can be read two ways. Candidates: resolve by longest match against the repo's refs; require `/` inside a ref to be percent-encoded; move the path to a query parameter.
- **Sub-path versus several skills per repo:** `@ref/path` as above, or a query parameter.
- **Canonical identity of a repo** for cache keys, given renames, transfers and case-insensitive names. Candidate: the host's immutable numeric id after first resolution.
- Whether a short commit hash is accepted, and if so whether it counts as pinned.
