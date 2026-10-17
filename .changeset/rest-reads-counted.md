---
"@skillcdn/serve": minor
---

The address routes take the usage hooks the tools take: a read through the REST API is counted as a call of its route (`rest/mounts`, `rest/browse`, `rest/find`, `rest/skills`, `rest/files`), the first page of a skill as a load of the skill, the first page of a file as a read of it, and the client by the product token its user agent begins with (`clientAppOf`; `browser` for a browser), at the address the app resolves for it.
