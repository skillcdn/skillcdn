# deploy/

Everything needed to build the image and hand it to whatever runs it. This repository stops at an image that builds: publishing images, registries, deployment pipelines, infrastructure, DNS, TLS, CDN and rollout live outside it ([ADR-0008](../docs/adr/0008-repository-ends-at-an-image-that-builds.md)).

| File | Purpose |
|---|---|
| [`Dockerfile`](Dockerfile) | The one multi-stage image. Roles `api`, `worker` and `migrate` are selected by the container command. |
| [`compose.dev.yaml`](compose.dev.yaml) | Local development dependencies (PostgreSQL 18). Not a production topology. |
| [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Lint, build, typecheck, tests (integration tests run against a PostgreSQL service container), secret scan, and an image build that is then exercised: exit codes, `migrate`, readiness, non-root user, clean shutdown. It needs no secrets. |

A compose bundle and install script for self-hosting are planned ([roadmap](../docs/roadmap.md)).

## Build and run locally

```sh
docker build -f deploy/Dockerfile -t skillcdn .      # from the repository root
docker run --rm skillcdn migrate                     # one-off role
docker run --rm -p 8080:8080 --env-file .env skillcdn api
```

The image runs as a non-root user, contains production dependencies only, and has no secrets and no configuration baked in.

## Environment contract

The server is configured only through environment variables. [`.env.example`](../.env.example) is the source of truth; this table adds what operators need to know. Both are updated in the same change as the config module.

| Variable | Roles | Required | Secret | Notes |
|---|---|---|---|---|
| `NODE_ENV` | all | no | no | The image sets `production`. |
| `LOG_LEVEL` | all | no | no | Default `info`. |
| `HOST`, `PORT` | `api` | no | no | Defaults `0.0.0.0` and `8080`. |
| `SHUTDOWN_GRACE_SECONDS` | `api` | no | no | Default `20`. Keep the platform's stop timeout above it. |
| `DATABASE_URL` | all | yes | **yes** | PostgreSQL connection string. |
| `DATABASE_POOL_MAX` | `api` | no | no | Default `10` connections per process. |
| `GITHUB_API_URL` | `api`, `worker` | no | no | Default `https://api.github.com`. GitHub Enterprise Server: `https://<host>/api/v3`. |
| `GITHUB_TOKEN` | `api`, `worker` | no | **yes** | Optional, no scopes needed. Raises the GitHub rate limit for public-repo reads; without it the anonymous limit applies to the whole deployment. |
| `REPO_TTL_SECONDS`, `REF_TTL_SECONDS` | `api` | no | no | How long repository facts and moving refs are trusted before revalidation. Default `60` each. |
| `INDEX_WAIT_MS` | `api` | no | no | How long a tool call waits for a new commit's index. Default `20000`. |
| `INDEX_CONCURRENCY`, `INDEX_LEASE_SECONDS` | `api`, `worker` | no | no | Commits indexed at once per process, and the lifetime of an indexing claim. |
| `INDEX_MAX_*`, `READ_MAX_FILE_BYTES` | `api`, `worker` | no | no | Limits on the work one repository may cause, including the unpacked size of a commit archive; see [`.env.example`](../.env.example). |

Invalid configuration stops the process with exit code `78` and a message that names the variable and the rule, never the value.

Every secret `NAME` may instead be provided as `NAME_FILE`, a path to a file holding the value, so secret mounts work. Secrets are injected at runtime by the platform (for example a task definition that references a secret store). They are never build arguments, image layers or committed files.

## Building a release

This repository does not publish images. Whatever deploys the product builds the image itself:

1. Pin a commit of this repository, preferably one whose `CI` run is green. `main` is kept releasable, so any green commit is a candidate.
2. Build `deploy/Dockerfile` from the repository root for the platforms you run (`docker buildx build --platform linux/arm64 -f deploy/Dockerfile .`). The build needs no secrets and no build arguments.
3. Tag the image with the commit it was built from, keep tags immutable in your registry, and deploy by digest.

## Rollout contract

Whatever rolls the image out must do this, in this order:

1. Run the new image with the `migrate` command to completion. A non-zero exit aborts the rollout.
2. Roll `api` and `worker` to the new image. Old and new versions overlap, which is why migrations are backward compatible (see [`packages/db/CLAUDE.md`](../packages/db/CLAUDE.md)).
3. Gate traffic on `GET /readyz`, restart on `GET /healthz` failures, and send `SIGTERM` with a grace period before killing.
4. Roll back by redeploying the previous digest. Because migrations only expand, the previous version keeps working.

`worker` tolerates interruption at any time, so it can run on interruptible capacity. `api` is stateless and scales horizontally behind any load balancer without session affinity.

## Repository settings checklist

Set once in GitHub; none of it can be expressed in files here.

- Branch protection on `main` is intentionally off for now: maintainers push directly. When the team moves to pull requests, require them together with the `CI` checks and a linear history.
- Enable secret scanning with push protection, Dependabot alerts and private vulnerability reporting.
- Actions: default `GITHUB_TOKEN` permission read-only; require approval before running workflows from first-time contributors.
- No cloud credentials, environments or deployment secrets belong to this repository. If a workflow here ever asks for one, that is a mistake.
