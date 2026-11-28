# ADR-0133: A deployment says which release it was built as

- Status: Accepted; how the version reaches the server (point 2) and what an image built without the argument says (point 3) are superseded by ADR-0134
- Date: 2026-11-28
- Builds on [ADR-0087](0087-the-image-of-a-release-is-published-and-an-installation-is-made-from-a-bundle.md) (the image of a release is published) and [ADR-0058](0058-the-published-packages-share-one-version.md) (the published packages share one version).

## Context

The server called itself `skillcdn` with the version `0.0.0`, a constant written when the MCP surface was first built: the protocol asks a server for a version, and the server workspace is published nowhere, so no release ever numbered it. The image of a release carried the release's version as a label alone, which a registry shows and the server inside does not know.

Nobody outside could tell which release a deployment ran. After a rollout, whether it had happened was judged by what the deployment did. And every deployment told the git host and the inference servers that it was `skillcdn/0.0.0`.

## Decision

1. **The server says the release it was built as, to whoever asks:** as the `version` of the MCP server info, at every address and at the root, and in the user agent of the calls it makes to the git host and to the servers of the search by meaning.
2. **The build names it.** `deploy/Dockerfile` takes the build argument `VERSION` and hands it to the server as `SERVER_VERSION`, which the configuration reads like any other variable. The release workflow passes the version of the release.
3. **A build that was told none says `0.0.0`:** a server run from source, an image built without the argument. It says no release rather than one it is not.
4. **The value is a version:** three numbers and what a build may write after them. Anything else is refused at startup, since it goes into a header.

## Consequences

- Which release a deployment runs is read from outside with one request, and a rollout is checked by it.
- The version is public. A deployment on an old release says so to anyone; an operator who wants it unsaid sets `SERVER_VERSION` to `0.0.0`.
- An image somebody builds themselves says `0.0.0` until its build passes the argument. What a commit between two releases is called is theirs to choose.
- The image of a release published before this decision keeps saying `0.0.0`: a version the registry has is never built again ([ADR-0116](0116-the-image-of-a-release-is-built-on-a-runner-of-each-platform-and-a-missing-one-by-the-next-run.md)).
- The image job of CI builds with a version no release has and asks the running server for it, so the way from the argument to the answer is checked on every push.

Rejected:

- **Reading the version of a published package inside the image.** It is the release only at the commit of a release; a build of any later commit would claim the release before it.
- **Numbering the server workspace with the packages.** Every release would then change a workspace that publishes nothing, for a number the build already knows.
- **A route of its own for the version.** The server info is where the protocol puts it, and one request reads it.
