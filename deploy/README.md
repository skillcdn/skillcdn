# deploy/

Everything needed to build the image and hand it to whatever runs it. This directory stops at a published image: infrastructure, DNS, TLS, CDN and rollout live outside this repository ([ADR-0005](../docs/adr/0005-public-repository-private-operations.md)).

| File | Purpose |
|---|---|
| [`Dockerfile`](Dockerfile) | The one multi-stage image. Roles `api`, `worker` and `migrate` are selected by the container command. |
| [`compose.dev.yaml`](compose.dev.yaml) | Local development dependencies (PostgreSQL 18). Not a production topology. |
| [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Lint, build, typecheck, tests (integration tests run against a PostgreSQL service container), secret scan and an image build on every change. |
| [`../.github/workflows/release.yml`](../.github/workflows/release.yml) | Builds the image and pushes it to Amazon ECR through GitHub OIDC. |

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
| `PORT` | `api` | no | no | Default `8080`. |
| `DATABASE_URL` | all | yes | **yes** | PostgreSQL connection string. |
| `GITHUB_TOKEN` | `api`, `worker` | no | **yes** | Optional. Raises the GitHub rate limit for public-repo reads. No scopes needed. |

Every secret `NAME` may instead be provided as `NAME_FILE`, a path to a file holding the value, so secret mounts work. Secrets are injected at runtime by the platform (for example a task definition that references a secret store). They are never build arguments, image layers or committed files.

## Release flow

1. A change lands on `main`. Maintainers currently push directly, so nothing gates this step, and `release.yml` does not wait for `ci.yml`. Before setting `PUBLISH_IMAGE`, make publishing depend on a green CI run.
2. `release.yml` builds `deploy/Dockerfile` and pushes `sha-<commit>` to ECR. A `vX.Y.Z` tag additionally pushes `X.Y.Z`, through the protected `production` environment.
3. Images carry provenance and SBOM attestations. Tags are meant to be immutable: configure the registry accordingly and deploy by digest.

The workflow does nothing until it is wired to an AWS account. Wiring is configuration in GitHub, not in this repository:

| Where | Name | Value |
|---|---|---|
| Repository variable | `PUBLISH_IMAGE` | `true` to enable the workflow |
| Repository variable | `IMAGE_PLATFORMS` | Optional. Default `linux/arm64`. Add `linux/amd64` when distributing to self-hosters. |
| Repository variable | `IMAGE_RUNNER` | Optional. Default `ubuntu-24.04-arm` (native arm64 build). |
| Environment variable (`staging`, `production`) | `AWS_ROLE_ARN` | IAM role assumed through OIDC |
| Environment variable | `AWS_REGION` | Region of the registry |
| Environment variable | `ECR_REPOSITORY` | Repository name inside the registry |

Requirements on the AWS side, provisioned elsewhere:

- An IAM OIDC identity provider for GitHub Actions and one role per environment. Each role's trust policy pins the token's `sub` claim to this repository **and** one environment (`repo:<org>/<repo>:environment:<name>`), so only jobs that passed that environment's protection rules can assume it.
- The role may push to that one ECR repository and nothing else.
- No long-lived access keys exist for CI. If one is ever created, that is an incident.

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
- Create the `staging` and `production` environments; require reviewers on `production`.
