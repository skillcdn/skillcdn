# Spec: address scheme

- Status: **Draft.** The grammar has not changed since milestone 1 and becomes normative with the surface of [ADR-0024](../adr/0024-skills-travel-through-the-mcp-skills-extension.md); the open questions below remain open.
- Implemented by: `packages/core` (`parseAddress`, `formatAddress`). Nothing else parses addresses.

An address identifies what an agent mounts. It is the path of the MCP endpoint URL, so the whole onboarding is one URL.

```
https://<service-host>/<git-host>/<owner>/<repo>[@<ref>][/<path>]

/gh/<owner>/<repo>                       default branch, latest commit
/gh/<owner>/<repo>@v1.2.0                a tag, a branch or a commit
/gh/<owner>/<repo>@main/skills/ads       a sub-path inside the repo
/gh/<owner>/<repo>/skills/ads            the same sub-path on the default branch
/gh/<owner>/<repo>@release/1.2:          a ref that contains "/"
/gh/<owner>/<repo>@release/1.2:skills    ... with a sub-path
```

## Components

| Part | Meaning | Rules |
|---|---|---|
| `<git-host>` | Which host adapter serves the repo. | `gh` is GitHub, the only value in v0. Other values are reserved for further adapters. Lowercase only. |
| `<owner>`, `<repo>` | Repository coordinates on the host. | Validated against the host's naming rules before any network call. GitHub matches names case-insensitively, so the canonical form is lowercase. A trailing `.git` is rejected. |
| `@<ref>` | Branch, tag or commit. Optional. | Omitted means the default branch. Must be a valid git ref name. A full 40-digit commit hash is *pinned*; everything else is *moving*. |
| `/<path>` | Directory inside the repo to mount. Optional. | Relative, never escapes the repo root. `.` and `..` segments, backslashes, empty segments (including a trailing slash) and control or invisible characters are rejected, not repaired. |

## Where the ref ends

Branch and tag names may contain `/`, so the grammar has to say where the ref stops:

1. The ref starts after the first `@` in the repository segment. Later `@` characters are literal (`@@scope/pkg@1.0.0:` names the tag `@scope/pkg@1.0.0`).
2. If a `:` follows, the ref ends at the first `:` and the path is everything after it. Git forbids `:` in ref names, so this is never ambiguous. It mirrors git's own `<rev>:<path>` syntax.
3. Otherwise the ref ends at the first `/`.

So `@main/skills/ads` and `@main:skills/ads` are the same address, and a ref with a slash always needs the terminator: `@release/1.2:` with no path, `@release/1.2:skills` with one. Written without it, `@release/1.2` means the ref `release` and the path `1.2`; when that ref does not exist, the error message points at this rule.

Parsing never consults the repository. An address means the same thing whatever refs exist, and its canonical form is computable offline.

## Encoding

- Segments are percent-decoded exactly once, as UTF-8. Malformed escapes and malformed UTF-8 are rejected.
- An encoded slash (`%2F`) or backslash (`%5C`) is rejected everywhere: intermediaries disagree on whether to decode it, so it would mean different things in different deployments.
- Encoded delimiters (`%40`, `%3A`) are equivalent to `@` and `:`.
- Refs and paths are case-sensitive and are not Unicode-normalized.
- The whole address is at most 2048 characters, a ref at most 255 and a path at most 1024.

## Canonical form

`formatAddress(parseAddress(x))` is the canonical form of `x`, and it parses back to the same address. It lowercases the owner, the repo and a full commit hash, percent-encodes what a URL path requires, and uses the `:` terminator only when it is needed (a `/` in the ref, or a `:` in the path).

## Semantics

- **Connect the repository root by default.** One connection can browse different areas of work and read shared references. A sub-path remains a supported access boundary, not a different path notation.
- **Content paths are repository-root paths.** On `/gh/acme/library/marketing`, `get_skill` still takes `marketing/skills/ad-copy/SKILL.md`, and file reads retain that same prefix. Names and shortened directory aliases are not content identifiers. Paths outside the mount are rejected. Applicable ancestor rules are delivered only through skill-context pages, without allowing arbitrary file reads above the mount ([tools](tools.md)).
- **Pagination identifies one indexed view.** Cursors bind to the commit's snapshot and reading-rule version, mount and request. A changed snapshot or request requires restarting the page sequence.
- **Pinned** addresses (full commit hash) always serve the same content and may be cached indefinitely.
- **Moving** addresses resolve to a commit at request time. Resolution is cached briefly and invalidated by push webhooks where the App is installed.
- **A short commit hash** is accepted wherever the host resolves it, but it is a moving ref: a prefix that is unique today can become ambiguous later, so it is never cached as immutable.
- **Repository identity.** After the first resolution a repository is identified by the host's immutable numeric id. The `owner/repo` spelling is a lookup alias that is re-pointed after a rename or a transfer, so an index survives both and a recycled name never inherits another repository's index.
- The parser is pure and total: every input yields either a parsed address or a typed error. It never throws on hostile input and never touches the network.

## As a skill URI

Over the MCP skills extension, a file of a skill is named by the address without its ref: `skill://gh/<owner>/<repo>/<path>`, with the file's repository-root path, and `skill://gh/<owner>/<repo>/<name>/SKILL.md` for a root-level skill ([ADR-0024](../adr/0024-skills-travel-through-the-mcp-skills-extension.md)). The ref stays with the connection, so the same URI names the same file at whatever commit the address serves. The part after the scheme is an address without a ref, so this grammar decides what is a valid URI; `parseSkillUri` and `formatSkillUri` in `packages/core` implement it ([tools](tools.md#the-skills-extension)).

## In a browser

The same URL answers people. When the deployment serves the web UI, a `GET` whose `Accept` header asks for `text/html` gets the explorer view of the address, rendered with what the address serves; every other request on the path is MCP ([ADR-0009](../adr/0009-web-ui-prerendered-per-language.md), [ADR-0011](../adr/0011-address-pages-rendered-on-the-server.md)). Query parameters are not part of an address: `lang` selects the language of the UI, `skill`, `file` and `q` select a view, and none of them means anything to MCP. Search engines may index the view of an address without a ref and the view of one of its skills; a page at a ref, a file and a search say `noindex`.

## Open questions

- **Commits that do not belong to the repository.** Some hosts serve a commit through a repository even when it only exists in a fork of it. A pinned address could then show someone else's content under the repository's name. Candidate: accept a pinned commit only when it is reachable from a branch or tag of the repository, and say so in the result otherwise.
- Fully qualified refs (`refs/tags/v1`, `heads/main`) are valid ref names and go to the host as they are. Whether the canonical form should fold them into the short name is undecided.
- Commit hashes longer than 40 digits (SHA-256 repositories) are treated as ref names until a host adapter supports them.
