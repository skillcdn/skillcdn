# packages/cli: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) first. This package is what an author installs; it is thin on purpose.

- **Arguments, environment and exit codes, nothing else.** The rules live in `@skillcdn/indexer`; a command here parses what it was given, hands it over and reports. Logic that is not about the command line moves down.
- **`src/bin.ts` is the only reader of `process`.** Everything else takes an `environment` record and output functions, so that `runCli` runs in a test without a process; every behavior has a test through it.
- **Exit codes are a contract.** `check` answers `0`, `1` or `2` as the server's role does; `64` is a usage error, `78` is configuration that cannot be read, `70` an internal failure. Changing one is a breaking change.
- **Output is for people and scripts alike.** The report goes to stdout, everything else to stderr; a problem names the variable and the rule, never the value.
- **No dependencies beyond the workspace.** Argument parsing is `node:util`; a library here needs a stronger case than anywhere but `core`.
