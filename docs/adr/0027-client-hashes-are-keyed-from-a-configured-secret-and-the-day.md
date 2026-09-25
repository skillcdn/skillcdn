# ADR-0027: Client hashes are keyed from a configured secret and the day

- Status: Accepted
- Date: 2026-09-26
- Supersedes points 2 and 3 of [ADR-0010](0010-distinct-clients-by-daily-keyed-hash.md) (the key made and stored in the database).

## Context

ADR-0010 counts distinct clients per repository and day as keyed hashes of their addresses, under one random key per day that the first process to ask makes in the database and that is deleted with the day. It rejected a secret in configuration because a leak would unmask every day at once.

Operating the service showed the other side of that trade. The key sits in the same database as the hashes, so whoever holds a copy of the database holds everything needed to match an address for the current day, and a backup taken during the day keeps that ability for as long as the backup exists. The key also costs a query per process and day, and clients seen before the key arrives wait in memory. A deployment that wants to say in its privacy policy what its database can reveal is better served by a database that can reveal nothing on its own.

## Decision

1. **The key of a day is derived, never stored:** `HMAC-SHA256(secret, day)`, where `secret` is `USAGE_HASH_SECRET` from the deployment's configuration. A client is still written as `HMAC(key of the day, address)`, once per repository and day, and the rows of a day are still folded into a count and deleted when the day is over.
2. **The database holds nothing that unmasks an address.** Matching a hash to an address needs the secret, which lives with the deployment's other secrets and never in the database, its backups, the logs or an export.
3. **Without a secret, each process makes its own at start** and keeps it in memory. Counting still works within that process; replicas and restarts within a day count a client more than once. A deployment with more than one replica, or one that wants exact counts, sets the secret.
4. **The exposure of a leaked secret stays bounded by the day.** Hashes exist only for the day being counted; once folded, no secret matches anything. Rotating the secret costs at most the current day's distinct count, which restarts from the rotation.

## Consequences

- The `usage_client_keys` table goes away. A process needs no query before it can count a client, and nothing waits for a key.
- `USAGE_HASH_SECRET` is one more secret to manage, with `USAGE_HASH_SECRET_FILE` for secret mounts like the others. The deploy documentation lists it with the reasons to set it.
- Rejected: keeping the stored key next to a configured one (two keys are not safer than one, and the database would still hold half of what unmasks); deriving the day's key from the database's own identity (a backup holds that too).
