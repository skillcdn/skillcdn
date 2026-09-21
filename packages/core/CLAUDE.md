# packages/core: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) first. This package is the product's contract and its most heavily tested code.

- **Pure.** No `node:` imports, no `process`, no network, no file system. The tsconfig loads no Node.js types on purpose; do not add them.
- **Deterministic.** No `Date.now()`, `Math.random()` or `crypto.randomUUID()`. Take a clock or an id source as a parameter (a port).
- **Parsers are total.** Every input yields a typed result or a typed error. They never throw on hostile input and never loop or allocate without a bound. Reject bad input; do not repair it.
- **Exported types are public contract.** Changing what `src/index.ts` exports for addresses, tool schemas or the skill-repo convention is a spec change: update `docs/specs/` in the same change, and keep it additive.
- **Ports are small.** An interface describes what the domain needs, in domain terms. It never mirrors a vendor SDK.
- **Runtime dependencies are nearly forbidden.** This package also ships to browsers. A new dependency here needs a stronger case than anywhere else.
- **Tests:** table-driven cases next to the code, and always a hostile-input group: traversal, oversized input, deep nesting, odd Unicode, malformed encodings.
