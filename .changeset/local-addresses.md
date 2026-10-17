---
"@skillcdn/core": minor
---

`local` is a host of the address grammar: `/local/<owner>/<name>[/<path>]` names a pack served from a machine by the `skillcdn` command, with no git host behind it, and `skill://local/<owner>/<name>/<path>` names its files (ADR-0053). `ADDRESS_HOST_KEYS` lists every host an address can name and `GIT_HOST_KEYS` stays the git hosts; `Address.host` is now `AddressHost`, and `GitHostAddress`, `isGitHostAddress` and `isGitHostKey` narrow to a git host where one is needed. The REST `repository.host` takes the same values. A deployment serves no `local` address.
