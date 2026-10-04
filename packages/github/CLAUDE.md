# packages/github: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) first. This package holds the most sensitive credentials in the system.

- **The only GitHub client.** No other workspace imports a GitHub SDK or calls the GitHub API. This package speaks the port from `@skillcdn/core` and returns core types, never SDK types.
- **Token discipline.** Indexing and every read of content use the installation token. A user token is used only to ask what that user can see: who they are, whether a name is a repository to them, and where the app is installed for them. Nothing asked with a user token is cached, and no content is ever read with one. Tokens arrive as arguments or through a provider passed in by the caller; a user token is never module state, and no token is ever logged, part of an error message or part of a returned value other than the credentials `exchangeCode` and `refresh` exist to return.
- **Errors are translated.** Map GitHub responses to the port's error kinds (not found or forbidden, rate limited, transient, invalid). Not found and forbidden must be indistinguishable to callers that face users.
- **Be cheap.** Send conditional requests, prefer tree and blob endpoints over per-file calls, honor `retry-after` and secondary rate limits, and back off with jitter.
- **The app's key signs and stays.** The private key is used to sign the app's own short-lived token and for nothing else; installation tokens are minted with read-only contents and metadata, whatever the installation would allow.
- **Webhooks:** verify the HMAC signature over the raw body with a constant-time comparison before parsing anything.
- **Base URL is operator configuration**, passed in by the caller. It is never derived from user input.
- **This package never reads the environment.**
- **Tests** run against recorded fixtures. Scrub fixtures before committing: no tokens, no private repository data, no real user identifiers. CI makes no live calls.
