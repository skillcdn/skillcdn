# ADR-0001: FSL-1.1-ALv2 license with a separate trademark policy

- Status: Accepted; ADR-0025 applies the directory-license clause of point 1 to `docs/specs`
- Date: 2026-09-21

## Context

We want anyone to read, run, modify and self-host SkillCDN, including for commercial purposes. We also operate SkillCDN as a service and need two things to stay ours: the right to be the party that offers it as a competing product, and the name.

## Decision

- Everything in this repository is licensed under the Functional Source License, Version 1.1, with Apache 2.0 as the future license (`FSL-1.1-ALv2`), unmodified. A directory may carry its own `LICENSE` file if it ever needs different terms.
- Names and logos are governed by [`TRADEMARKS.md`](../../TRADEMARKS.md), independently of the code license.
- External contributions are accepted under the contributor terms in [`CONTRIBUTING.md`](../../CONTRIBUTING.md), which let KDX Labs license the project as a whole.
- Commercial and enterprise-only modules live outside this repository under their own terms.

## Consequences

- Any use is permitted except a Competing Use as the license defines it. Internal use, self-hosting, modification, redistribution and professional services are all fine.
- Each release becomes Apache 2.0 two years after it is published. The protection is a head start, not a lock.
- FSL is not an OSI-approved license. We say **source-available**, never "open source", in docs and communication.
- A standard, unmodified text keeps legal review cheap for adopters. We do not add custom clauses.
- Dependencies must be permissively licensed so that the future Apache 2.0 grant stays clean and images stay distributable.
- Rejected: a permissive license alone (nothing prevents a competing hosted offering); strong copyleft (adoption friction for the organizations we want to reach, and it does not address competing hosting); a parameterized source-available license with a custom use grant (more to explain, longer conversion period); a custom license (unfamiliar and expensive to review).
