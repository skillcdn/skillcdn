# packages/cli: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) first. This package is what an author and an agent install; it is thin on purpose.

- **Arguments, environment, output and exit codes, nothing else.** The reading rules are `@skillcdn/indexer`'s, the reads `@skillcdn/reader`'s, the words `@skillcdn/core`'s, a deployment `@skillcdn/client`'s and the edges `@skillcdn/serve`'s; a command here parses what it was given, hands it over and prints. Logic that is not about the command line moves down.
- **`src/bin.ts` is the only reader of `process`.** Everything else takes an `environment` record and output functions, so that `runCli` runs in a test without a process; every behavior has a test through it.
- **Exit codes are a contract** (ADR-0055). `check` answers `0`, `1` or `2` as the server's role does; a read answers `1` for what the pack does not have or refuses and `2` for a pack that cannot be read at all; `64` is a usage error, `78` configuration that cannot be read, `70` an internal failure. Changing one is a breaking change.
- **Output is for people and scripts alike.** The report goes to stdout, everything else to stderr; a problem names the variable and the rule, never the value.
- **No dependencies beyond the workspace.** Argument parsing is `node:util`; a library here needs a stronger case than anywhere but `core`.
