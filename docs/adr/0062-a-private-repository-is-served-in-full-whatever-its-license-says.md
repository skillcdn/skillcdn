# ADR-0062: A private repository is served in full, whatever its license says

- Status: Accepted
- Date: 2026-10-20
- Amends: [ADR-0026](0026-serving-follows-the-license-and-the-operators-lists.md); answers the question [ADR-0061](0061-a-private-repository-carries-no-provenance-notice.md) left open.

## Context

The license a skill carries decides whether a deployment passes its content on or only describes it with a link to its source; a verified repository's default branch is served in full, and every other mount describes a restrictive skill ([ADR-0026](0026-serving-follows-the-license-and-the-operators-lists.md)). The rule exists because a deployment that serves a public repository redistributes its content to anyone who holds the address, and a license that forbids copies forbids that.

A private repository is served to nobody but the people the git host lets see it, who signed in and connected it, or an agent holding a token one of them made for that one repository ([ADR-0035](0035-people-sign-in-through-the-git-hosts-app.md), [ADR-0036](0036-the-deployment-is-the-authorization-server-of-its-addresses.md), [ADR-0040](0040-a-token-for-an-agent-reads-one-repository-as-its-maker.md)). They have the content at the host already; serving it to them is not redistribution. An organization's own pack is also exactly the repository that carries no license or reserves all rights, so the rule of ADR-0026 described the skills such a pack holds to the very people they were written for. ADR-0061 removed the provenance notice from private repositories and left this question open.

## Decision

1. **A private repository is served in full, on every ref, whatever license its skills or its root carry.** Nothing in it is described only; `read_repo_file` serves every eligible file; the skills extension lists every skill that would otherwise be listed.
2. **It is still not verified.** No mark on the pages, no vouching, no change to the operator's lists. Being connected by someone the host lets see the repository is what admits the content, and visibility is the fact the reader decides by, as it does for the notice.
3. **Public mounts are unchanged.** The license decides for them as ADR-0026 says.

## Consequences

- An organization's pack works without a license file and with a proprietary one alike.
- The decision is made at read time from the mount's visibility, like the notice: a repository that becomes public is served under the license rule from the next request, and one that becomes private is served in full.
- The reader's rule and the specifications change when this is built; the roadmap lists it among what is decided and not yet built.
- Rejected: counting a private repository as verified (verification is someone's word about a repository, and nobody gave one); a switch per repository (a person who can see the repository has nothing to choose).
