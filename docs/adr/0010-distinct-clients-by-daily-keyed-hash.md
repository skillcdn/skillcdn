# ADR-0010: Distinct clients are counted by a keyed hash that dies with the day

- Status: Accepted
- Date: 2026-09-22

## Context

Usage statistics per public repository (connections, tool calls, skill loads) are additive counters that hold nothing about who made them. A ranking needs one more number: how many *different* clients used a repository, so that one client calling a tool a thousand times does not outrank a hundred clients calling it once. Counting distinct things means telling them apart, and the only thing an anonymous MCP client has is its network address, which is personal data and must not be kept.

A client will have an account once MCP OAuth exists; until then the address is what there is.

## Decision

1. **A client is its network address, as resolved behind trusted proxies.** When accounts exist, an authenticated client is counted by its account instead. Requests without a resolvable address are not counted.
2. **The address is stored only as a keyed hash.** Each UTC day has one random key, made in the database by whichever process asks first and shared by all. A client is written as `HMAC(key, address)`, once per repository and day.
3. **The key lives one day.** When the day is over, the rows of that day are folded into a `client` count per repository in `usage_daily` and deleted, and so is the key. After that nothing in the database can be matched to an address, even by whoever holds a list of addresses.
4. **Counting never blocks a request.** Clients are noted in memory and written in batches, like the other counters; a client seen before on the same day is not written again.

## Consequences

- Rankings can use distinct clients per day, available the day after. The count is approximate in the way any address-based count is: clients behind one address count once, a client that changes address counts twice.
- For at most one day the database holds hashes that could be matched to an address by someone who has both the key and the address; the key is never logged or exported, and the exposure ends with the day.
- Rejected: storing addresses (personal data, kept for no reason); a fixed secret in configuration (one more secret to manage, and a leak would unmask every day at once); a cardinality sketch such as HyperLogLog (no standard support in PostgreSQL, and the counts here are small enough for exact rows).
