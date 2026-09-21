## What and why

<!-- One or two sentences. Link the issue or roadmap item. -->

## Checklist

- [ ] `pnpm check` passes locally
- [ ] Tests cover the change (or it is docs/config only)
- [ ] Docs updated per the table in `CLAUDE.md` → "Documentation protocol" (specs, architecture, `.env.example`, roadmap, package README)
- [ ] No secrets, account identifiers, internal hostnames, pricing or production tuning values in the diff
- [ ] Database change is backward compatible with the previous release (expand, then contract)
- [ ] Public contract (address scheme, tool names and schemas, REST) unchanged, or the change is additive, or an ADR explains the break

<!-- Delete lines that do not apply. -->
