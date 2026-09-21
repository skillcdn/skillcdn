# @skillcdn/github

The GitHub implementation of the git-host port defined in `@skillcdn/core`. It is the only place in the codebase that talks to GitHub.

**Status:** empty entry point. The public-repo adapter arrives in milestone 1; App authentication and OAuth follow ([roadmap](../../docs/roadmap.md)).

## Scope

| Capability | Used for | Credential |
|---|---|---|
| Resolve a ref to a commit; read trees and blobs | Indexing and `read_file` | None or an optional token for public repos; the App installation token for private repos |
| "Can this user see this repo?" | Permission check on private repos | The user's token |
| GitHub App: installation tokens, installation and repo selection events | Private repos | App private key |
| Webhook signature verification | Push, membership, team and visibility events | Webhook secret |

Other hosts (GitLab, Gitea) are separate packages that implement the same port.
