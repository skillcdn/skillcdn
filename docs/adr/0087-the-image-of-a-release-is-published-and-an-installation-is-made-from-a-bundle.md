# ADR-0087: The image of a release is published, and an installation is made from a bundle

- Status: Accepted
- Date: 2026-11-11
- Amends [ADR-0008](0008-repository-ends-at-an-image-that-builds.md), which left a published image for self-hosters to arrive with the self-hosting bundle; builds on [ADR-0046](0046-packages-are-published-to-npm-through-trusted-publishing.md) (publishing with no stored secret), [ADR-0058](0058-the-published-packages-share-one-version.md) (one version), [ADR-0065](0065-meaning-search-runs-on-open-weight-models-served-beside-the-image.md) (models served beside the image) and [ADR-0071](0071-a-deployment-serves-packs-from-a-directory-of-its-own.md) (packs from a directory).

## Context

Whoever wanted to run the product cloned the repository and built the image, some minutes and a toolchain away from trying it, and wrote the settings by hand. An installation without internet followed a procedure of five commands in the deploy documentation, with nothing that checked what arrived. ADR-0008 kept publishing out of the repository because the workflow that did it belonged to one deployment's accounts, and said that a published image for self-hosters is a product decision of its own. The installations this release is for run where nothing outside the host is reached.

## Decision

1. **The release workflow publishes the image of each release.** When the packages of a release are published, the same workflow builds the image from the same commit and pushes it to the container registry of the repository's own host, as `ghcr.io/skillcdn/skillcdn:<version>` and `latest`, for `linux/amd64` and `linux/arm64`, with the build's provenance and a list of what it contains attached. It signs in with the token of its own job: no stored secret, no cloud account, nothing of any deployment. A version the registry has is never built again.
2. **The image's version is the version the packages share.** A release is one commit, and its packages and its image are built from it. The server keeps no version of its own beyond that: a deployment may still pin any commit whose checks passed and build the image itself, as before.
3. **`install.sh` installs the bundle on one host.** It checks for docker and its compose plugin, writes the settings file with secrets of its own making, readable by its owner alone, brings the compose bundle up on the image of the release its files are of, and waits until the server is ready. It takes no secret as an argument and prints none. Run again, it keeps every setting and brings the bundle up on what it is told. The overlays it turned on are written into the settings, so that `docker compose` in that directory means the installation as it was installed.
4. **An installation without internet is made from a bundle.** `bundle.sh`, run where there is internet, puts into one directory the images, the release's and the database's and, when asked, the inference server's, the files of `deploy/`, the model files of the profiles asked for, and the digest of every file. `install.sh --offline` checks every file against those digests, loads the images, and never pulls. Nothing of an installation's own goes into a bundle: no settings, no secret, no pack.
5. **The packs of a host's directory are an overlay.** `compose.packs.yaml` mounts a directory of the host read-only into the two roles that read it and serves its packs at `local` addresses; the script turns it on with `--packs`.

## Consequences

- Trying the product is one script on a host with docker; an installation without internet is one directory carried over and the same script.
- The repository's host holds a public package beside the repository. Making it public and letting the workflow write it is set once, by a maintainer, as the npm publishers were ([deploy](../../deploy/README.md#repository-settings-checklist)).
- The workflow can be run only by a release: its first run is the first release after this record, and what that run shows is checked then.
- A deployment's own registry, accounts and pipeline stay outside, as ADR-0008 says. The registry named here is where the open image is given to everyone, as the package registry is for the packages.
- The bundle carries the images by the tags the compose files name and records the digests it saved, so an installation can say what it runs.
- Rejected: publishing an image for every commit of `main` (that is one deployment's cadence, and a self-hoster wants releases); an installer fetched from a URL and piped into a shell (it would tie the product to a hostname, and the script must travel with the files it runs, above all where there is no internet); manifests for a cluster (the bundle is one host; what orchestrates more is the operator's); signing with a key of our own (the provenance is keyless and says which workflow built the image from which commit).
