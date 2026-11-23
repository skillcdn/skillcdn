# ADR-0127: Discovery and the lists say how long a client keeps them, and whose they are

- Status: Accepted
- Date: 2026-11-24
- Builds on [ADR-0006](0006-mcp-sdk-v2-per-request-servers.md) (a server is made per request, for both protocol eras), [ADR-0024](0024-skills-travel-through-the-mcp-skills-extension.md) (the cache fields of the skills extension), [ADR-0068](0068-a-mount-serves-the-last-indexed-commit-while-the-newest-is-not-ready.md) (an index that answers for another) and [ADR-0070](0070-a-deployment-is-searched-across-every-pack-it-serves.md) (the root of a deployment).

## Context

In the current protocol revision a cacheable result says how long a client may keep it (`ttlMs`) and whether a cache between people may hand it on (`cacheScope`). The results of the skills extension have said both since ADR-0024. Three answers are built by the SDK and by no handler of ours: `server/discover`, `tools/list` and `prompts/list`. They left with the SDK's defaults, nothing kept and private, so a client of that revision, which opens no connection, was told to ask again every time it needed one, and each such request resolves the mount and reads its catalog to answer what is, for the two lists, a constant of the release. The SDK takes a hint for each of the three when the server is made, and the server is made per request, with the mount and its catalog at hand.

The three are not alike. The lists are the same at every address and change with a release alone. `server/discover` carries the connection instructions, which are the mount's: the commit, the counts, the folders, the diagnostics, the manifest's name and description. It also carries what the lists carry, the release's: its version, its capabilities and the lines on the tools.

## Decision

1. **The lists of the tools and the prompts are kept an hour on a deployment** (`SURFACE_TTL_MS` of `@skillcdn/serve`). While the major version is 0 a release may change a tool, and an hour bounds how long a client calls with the list of the release before.
2. **`server/discover` is kept as a list of the extension is, and never longer than the lists.** What remains of the ref resolution's life; five seconds, or what remains where that is less, while the commit is being indexed, could not be, or another index answers for it; and at most the hour of point 1, for a commit that never changes too, since the release wrote part of what it says.
3. **`cacheScope` follows the repository in all three:** `public` for a public repository, `private` for any other. The lists hold nothing of a repository, but an answer at a private address says that the address is there. A cache between people that handed it on would tell a repository a person may not see from one that does not exist.
4. **The root of a deployment says the hour and `public`** for its discovery and its list: it answers everyone alike. The count of packs in its instructions may be that old; where the count could not be read, its discovery says to keep nothing.
5. **Whoever composes the server gives the lifetime** (`surfaceTtlMs` of `createMountServer` and `createHubServer`); left out, nothing is kept. A deployment gives the hour. The command serving a directory gives nothing, so what is served from a machine keeps saying what [ADR-0057](0057-a-directory-is-served-by-the-command-over-stdio-and-http.md) has it say.
6. **The hour is a constant of the surface, not configuration.** It is what the protocol tells every client of every installation, written in the specification as the day of a pinned commit and the five seconds of an index in the making are. How long a deployment believes its git host stays the operator's to set (`REF_TTL_SECONDS`), and the discovery of a moving ref follows it.

## Consequences

- A client of the current revision may keep the lists an hour and discovery for the life of a ref resolution, where it was told to keep neither. A client of the revisions before sees nothing change: those have no cache fields.
- After an upgrade a client may call with the lists of the release before for up to an hour, and a call the new release does not take is answered as an error the model reads. An installation that cannot have that is the reason there would be to make the hour configuration; nothing asks for it yet.
- A client that kept the discovery of a moving ref sees a push when the ref resolution it was answered from ends, as it does with the lists of the extension.
- For up to an hour after a public repository is made private, a cache between people may hand on the lists it kept of the address. They say that the repository was public within the hour, and nothing of what it holds.
- **Rejected:**
  - one lifetime for the three, the lists': discovery would introduce a commit its ref has left for an hour after a push;
  - `public` for the lists at every address, since they are the same everywhere: point 3;
  - a day for the discovery of a pinned commit, as the results of the extension have: its instructions and capabilities are the release's, and would outlive the lists that are bounded for that very reason;
  - an environment variable for the hour: one more thing to set, with no installation that needs another value, and point 6;
  - keeping the lists where a directory is served from a machine: nothing is saved between a client and a process on one machine, and a command started again in another version would be called with the old list.
