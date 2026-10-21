---
"@skillcdn/core": patch
---

`GitHostLogin` may answer `repositoryPermission`, what the holder of a token may do at a repository as the host puts it (`HostRepositoryPermission`: `admin`, `write` or `read`), and the REST API gains what a person asks of a repository's index (ADR-0064): `GET /api/v1/me/index/<address>` says whether they administer the repository (`restMyIndexSchema`), and `POST` queues it to be indexed now (`restIndexNowSchema`). A host login without the method makes nobody an administrator.
