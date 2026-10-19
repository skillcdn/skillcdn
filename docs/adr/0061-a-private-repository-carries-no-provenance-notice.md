# ADR-0061: A private repository carries no provenance notice

- Status: Accepted
- Date: 2026-10-19
- Amends: [ADR-0019](0019-the-operator-vouches-for-repositories-until-owners-can.md) (the notice), not [ADR-0026](0026-serving-follows-the-license-and-the-operators-lists.md) (the license).

## Context

Every result from a repository nobody has vouched for carries a provenance notice: the content comes from the repository author and applies to the task the user asked for, not to unrelated actions ([ADR-0019](0019-the-operator-vouches-for-repositories-until-owners-can.md)). The notice exists because a public address can be handed to anyone, and the model reading the result should know whose word it is taking. Vouching is the operator's list today ([ADR-0026](0026-serving-follows-the-license-and-the-operators-lists.md)), and a private repository is never on it: the operator does not read private content, and nobody asked it to.

Since milestone 5 a private repository is served only to a person the git host lets see it, who signed in and connected it, or to an agent holding a token that person made for that one repository ([ADR-0040](0040-a-token-for-an-agent-reads-one-repository-as-its-maker.md)). The repository is theirs or their organization's; the person chose it on purpose. Telling their model that the content is unverified says nothing true about trust, and it marks the repository as a stranger's on every result.

## Decision

1. **A mount of a private repository carries no provenance notice.** The notice follows a repository that is public and that nobody has vouched for, and nothing else.
2. **A private repository is not verified by this.** It gets no verified mark on the pages, and what the license of a skill decides is unchanged: a verified repository's default branch is served in full, and every other mount, a private one included, describes a restrictive skill with a link to its source ([ADR-0026](0026-serving-follows-the-license-and-the-operators-lists.md)).
3. **The pages mark a private repository as private**, as they do, and that mark is the whole of what distinguishes it.
4. **The reader is told the repository's visibility** with the mount, as it is told whether someone vouched for it; the summary every result carries says both. A directory served by the `skillcdn` command is private and verified, so nothing changes for it.

## Consequences

- An organization's own pack reads like its own: no warning on every result, no need to ask the operator for anything.
- Whether a private repository's restrictive licenses should also be served in full to its own members is a separate question, left open here: the license decides what the deployment passes on, and ADR-0026 did not consider a reader who already has the content at the host.
- Rejected: marking private repositories verified (verification is someone's word about a repository, and nobody gave one; it would also change the license rule above by accident); a weaker notice for private repositories (a notice the model is meant to weigh less is noise).
