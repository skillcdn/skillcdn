# packages/client: rules

Read the root [`CLAUDE.md`](../../CLAUDE.md) first. This package is the REST API as a client: thin, typed, and the same in Node.js and a browser.

- **One function per route, parsed with core's schemas.** Nothing is read from an answer that the schema does not say; an answer the schema refuses is `invalid_response`, never a partial object.
- **A token goes to its origin and nowhere else.** The bearer is sent to `baseUrl` only; a redirect is never followed (`redirect: "error"`). Nothing here logs, prints or keeps a token.
- **Every failure is an `ApiError`** with the code the API gave, or `network` / `invalid_response`. No other exception leaves a call, except the caller's own abort.
- **Bounded.** Every request has a timeout and every body a size bound; a deployment is someone else's server.
- **No Node.js in the code.** `fetch`, `AbortSignal` and `URLSearchParams` only, so that the web UI runs it as the command does. A dependency beyond `core` needs a stronger case than anywhere but `core`.
