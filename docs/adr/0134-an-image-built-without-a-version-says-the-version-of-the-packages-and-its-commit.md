# ADR-0134: An image built without a version says the version of the packages and its commit

- Status: Accepted
- Date: 2026-11-28
- Supersedes, of [ADR-0133](0133-a-deployment-says-which-release-it-was-built-as.md), how the version reaches the server (point 2) and what an image built without the argument says (point 3); builds on its other points and on [ADR-0058](0058-the-published-packages-share-one-version.md) (the published packages share one version).

## Context

ADR-0133 let the build name the version, and an image that was told none said `0.0.0`. A deployment that follows `main` between releases builds the image itself ([deploy/README.md](../../deploy/README.md#building-a-release)), so its build had to pass the argument every time. One that left it out said nothing, without a warning, and the version is there to tell deployments apart.

ADR-0133 turned down reading the version of the packages inside the image: a commit after a release carries the number of the release before it, and its image would pass for that release. That holds for the number alone. What such an image is built from is a commit, and the checkout says which.

## Decision

1. **An image built without `VERSION` says the version of the packages in its tree and the commit it is built from:** `1.2.3+abc1234`, the first seven characters of the commit after a `+`. What follows the `+` marks it as no release. The image of a release, which the release workflow names, says the version alone.
2. **The commit is read from the checkout, without git.** `.dockerignore` lets three things of `.git` into the build: `HEAD`, `packed-refs` and the files under `refs/heads`. The build reads the head and the branch it names, from the build context: the three are taken out of the tree it builds in, where the build of the pages takes a `.git` for the whole repository. Nothing else of `.git` enters the build, and none of it enters the image.
3. **When the checkout does not say, the mark is `source`:** `1.2.3+source`, from a build context without those files, a worktree, or refs kept in another format.
4. **The build writes what it worked out into a file of the image, and the image names the file** in `SERVER_VERSION_FILE`, since a Dockerfile cannot set a variable to what a step worked out. The configuration reads the file when the deployment names no version; `SERVER_VERSION` set by the deployment is said instead.
5. **A version that is none fails the build,** a `VERSION` argument included, rather than making an image whose server is refused at startup.
6. A server run from source still says `0.0.0`.

## Consequences

- A deployment that builds its own image says which commit it runs, with no argument to remember, and a rollout is checked against the commit that was built.
- Between two releases the version of the packages is that of the release before. `1.2.3+abc1234` says "the tree numbered 1.2.3, at this commit", never "release 1.2.3": the commit is what tells.
- The commit says what was checked out, not whether the tree had changes that were not committed.
- The commit a deployment runs is public, as its version is (ADR-0133); a deployment that wants it unsaid sets `SERVER_VERSION`.
- The image job of CI builds without the argument, as such a deployment does, and asks the running server for the version of the packages with the commit of the run. The argument is passed by the release workflow alone.
- What works the version out is part of the server (`print-image-version.js` in its `dist`), so that it is tested with it; the build runs it and a deployment never does.

Rejected:

- **A second build argument for the commit.** It is the argument to remember again.
- **All of `.git` in the build, and git asked.** The build would carry the history and the settings of the checkout, which may hold a credential, for one line.
- **The form `git describe` writes, `1.2.3-4-gabc1234`.** It needs the tags and the history, and as a version it orders before `1.2.3`.
