---
"@skillcdn/serve": patch
---

Requires the releases of its HTTP framework that carry security fixes: `hono` 4.13.16 and `@hono/node-server` 2.1.6 at least. A request path with an encoded line terminator no longer passes around middleware written for a wildcard path, and a path with a raw backslash is refused with `400` instead of being read as a slash, which matters to a directory served behind a proxy that routes by path. Nothing changes in how `skillcdn serve` and the library are used.
