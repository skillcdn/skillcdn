# ADR-0026: What a deployment serves follows the license it finds and the operator's lists

- Status: Accepted
- Date: 2026-09-26
- Supersedes point 4 of ADR-0011 (what the sitemap lists) and moves the environment list of point 2 of ADR-0019 into the operator's lists.

## Context

A deployment that serves other people's repositories redistributes what they published: it assembles a skill from several files and hands the result to an agent under its own address ([ADR-0025](0025-a-skill-on-the-wire-is-assembled-from-its-sources.md)). The git host's terms let it read public content; what it may pass on depends on each repository's license, which ranges from permissive to none to all rights reserved. Some repositories must not be served at all, some owners will want theirs taken down, and a public listing of what a deployment serves must not turn a request for an address into an endorsement.

## Decision

1. **The license a skill carries decides how it is served.** The first of these that exists speaks: a license file in the skill's directory, the skill's `license` field, then the repository's license, its root license file or the root manifest's `license`. A permissive license serves the skill in full, with its notice. A restrictive one (all rights reserved, no redistribution, non-commercial, or a text the reader does not recognize) serves the name, the description and a link to the source, and nothing else, unless the owner has verified the repository. No license serves the skill in full with its provenance, and the repository is never featured.
2. **The operator keeps three lists in one table:** verified, featured and blocked repositories, managed through an admin API guarded by a token. The environment list of ADR-0019 moves there. A blocked repository answers like one that does not exist; the deny list is the default implementation of the entitlements port. The sitemap, the landing page and the explorer read the lists, featured and verified, and never the repositories the most clients used. A `purge` command removes a repository's snapshots and index and the blobs nothing references any more.
3. **Only the default branch is verified.** The operator's or the owner's word holds for what the repository's default branch serves; every other ref is served as unverified.
4. **The deployment says what it does with content.** This repository's README states that the service reads, indexes and serves what a repository publishes, keeps copies only to serve them, and takes them down on request; where to ask is part of an operator's own pages.

## Consequences

- Restrictive content stays discoverable as a fact, that a skill exists and where, without being redistributed; its owner can allow serving by verifying the repository.
- License reading is a classification in `core` over the same untrusted input as everything else. A license the reader cannot name is restrictive, which is the safe mistake.
- A takedown is one row on the blocked list and one `purge`. The address then answers as if the repository did not exist, which is what an unknown repository answers too.
- Rankings by use may exist as data; promotion follows the operator's lists. What the most clients used no longer puts a repository into the sitemap.
- Rejected: serving everything and relying on takedowns (a notice does not make redistribution of reserved content right); serving nothing without a license (most repositories have none, and reading them is what the git host offers); a per-file license scan (the unit that is served, and that a reader takes, is the skill).
