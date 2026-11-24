---
"@skillcdn/serve": patch
---

Requires the release of its Node.js server adapter that carries two security fixes: `@hono/node-server` 2.1.11 at least. Both are in the handling of an `Upgrade` request that is not for a WebSocket, and affect an application that turns on the adapter's `websocket` option: such a request was left open, and a connection reset at that moment ended the process. `listenOn` and `skillcdn serve` do not turn the option on, so nothing changes in how they answer; an application that builds its own listener on the adapter beside this package, with WebSockets, gets the fixes with the update.
